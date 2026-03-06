#!/usr/bin/env python3
import argparse
import json
import mimetypes
import os
import random
import re
import shutil
import string
import subprocess
import time
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import paramiko
import pymysql
import requests

PROJECT_ID = "qualiteam-app"
MYSQL_HOST = os.getenv("QT4_LEGACY_MYSQL_HOST", "qualiteam.cua.uam.mx")
MYSQL_PORT = int(os.getenv("QT4_LEGACY_MYSQL_PORT", "3306"))
MYSQL_DB = os.getenv("QT4_LEGACY_MYSQL_DB", "qualiteam")
MYSQL_USER = os.getenv("QT4_LEGACY_MYSQL_USER", "")
MYSQL_PASS = os.getenv("QT4_LEGACY_MYSQL_PASS", "")
SSH_HOST = os.getenv("QT4_LEGACY_SSH_HOST", MYSQL_HOST)
SSH_PORT = int(os.getenv("QT4_LEGACY_SSH_PORT", "22"))
SSH_USER = os.getenv("QT4_LEGACY_SSH_USER", "")
SSH_PASS = os.getenv("QT4_LEGACY_SSH_PASS", "")
LEGACY_FILES_DIR = os.getenv("QT4_LEGACY_FILES_DIR", "/opt/archivos_proyecto")
CUTOFF = "2025-07-01 00:00:00"
ADMIN_EMAILS = {"jorge.cervantes.ojeda@gmail.com"}
WORK_DIR = Path("migration_work")
DATA_FILE = WORK_DIR / "prepared_data.json"
UPLOAD_STATE_FILE = WORK_DIR / "upload_state.json"
API_KEY = None


def now_iso() -> str:
  return datetime.now( timezone.utc ).isoformat()


def normalize_text(value):
  if value is None:
    return ""
  text = str(value).strip()
  return text


def normalize_role_text(raw):
  text = normalize_text(raw).lower()
  text = unicodedata.normalize("NFKD", text)
  return "".join(ch for ch in text if not unicodedata.combining(ch))

def normalize_status(raw):
  value = normalize_text(raw).lower()
  value = value.replace("ó", "o").replace("í", "i").replace("á", "a").replace("é", "e").replace("Ã³", "o")
  mapping = {
    "en creacion": "In Creation",
    "en creaciÃ³n": "In Creation",
    "en revision": "In Review",
    "en revisiÃ³n": "In Review",
    "revisado": "Reviewed",
    "rechazado": "Rejected",
    "reemplazado": "Replaced",
    "aceptado": "Accepted",
  }
  return mapping.get(value, "In Creation")


def normalize_thread_status(raw):
  value = normalize_text(raw).lower()
  value = value.replace("ó", "o")
  return "open" if ("abierto" in value or value == "open") else "closed"


def normalize_email(email, legacy_id):
  text = normalize_text(email).lower()
  # Legacy DB includes malformed emails with commas/spaces in the domain.
  text = text.replace(" ", "").replace(",", ".").replace(";", ".")
  text = re.sub(r"\.+", ".", text)
  if text and re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", text):
    return text
  safe = re.sub(r"[^a-zA-Z0-9._-]", "", str(legacy_id)) or "legacy"
  return f"legacy-{safe}@qualiteam.local"


def is_legacy_placeholder_email(email):
  text = normalize_text(email).lower()
  return text.startswith("legacy-") and text.endswith("@qualiteam.local")


def local_uid_from_legacy_id(legacy_id):
  safe = re.sub(r"[^a-zA-Z0-9_-]", "", str(legacy_id)) or "user"
  return f"legacy_local_{safe}"


def version_to_int(version_value):
  text = normalize_text(version_value).replace(",", ".")
  if not text:
    return None
  try:
    return int(round(float(text) * 100))
  except ValueError:
    return None


def to_firestore_value(value):
  if value is None:
    return {"nullValue": None}
  if isinstance(value, bool):
    return {"booleanValue": value}
  if isinstance(value, int):
    return {"integerValue": str(value)}
  if isinstance(value, float):
    return {"doubleValue": value}
  if isinstance(value, list):
    return {"arrayValue": {"values": [to_firestore_value(v) for v in value]}}
  if isinstance(value, dict):
    return {"mapValue": {"fields": {k: to_firestore_value(v) for k, v in value.items()}}}
  return {"stringValue": str(value)}


def fs_fields(data):
  return {k: to_firestore_value(v) for k, v in data.items()}


def chunked(seq, size):
  for i in range(0, len(seq), size):
    yield seq[i:i + size]


def firebase_tokens():
  cfg = json.loads((Path.home() / ".config" / "configstore" / "firebase-tools.json").read_text(encoding="utf-8"))
  tokens = cfg.get("tokens", {})
  client = subprocess.check_output(
    [
      "node",
      "-e",
      "const api=require(process.env.APPDATA+'\\\\npm\\\\node_modules\\\\firebase-tools\\\\lib\\\\api'); console.log(JSON.stringify({id:api.clientId(),secret:api.clientSecret()}));",
    ],
    text=True,
  ).strip()
  c = json.loads(client)
  return {
    "access_token": tokens.get("access_token", ""),
    "refresh_token": tokens.get("refresh_token", ""),
    "expires_at": int(tokens.get("expires_at", 0)),
    "client_id": c["id"],
    "client_secret": c["secret"],
  }


class GoogleSession:
  def __init__(self):
    self.t = firebase_tokens()
    self.s = requests.Session()

  def _refresh(self):
    payload = {
      "grant_type": "refresh_token",
      "refresh_token": self.t["refresh_token"],
      "client_id": self.t["client_id"],
      "client_secret": self.t["client_secret"],
    }
    r = self.s.post("https://www.googleapis.com/oauth2/v3/token", data=payload, timeout=30)
    r.raise_for_status()
    d = r.json()
    self.t["access_token"] = d["access_token"]
    self.t["expires_at"] = int(time.time() * 1000) + int(d.get("expires_in", 3600) * 1000)

  def req(self, method, url, **kwargs):
    if self.t["expires_at"] < int(time.time() * 1000) + 120000:
      self._refresh()
    headers = kwargs.pop("headers", {})
    headers["Authorization"] = f"Bearer {self.t['access_token']}"
    r = self.s.request(method, url, headers=headers, timeout=60, **kwargs)
    if r.status_code == 401:
      self._refresh()
      headers["Authorization"] = f"Bearer {self.t['access_token']}"
      r = self.s.request(method, url, headers=headers, timeout=60, **kwargs)
    return r


class FirestoreRest:
  def __init__(self, gs):
    self.gs = gs
    self.base = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents"

  def list_collection(self, collection):
    docs, token = [], None
    while True:
      url = f"{self.base}/{collection}?pageSize=500"
      if token:
        url += f"&pageToken={token}"
      r = self.gs.req("GET", url)
      if r.status_code == 404:
        break
      r.raise_for_status()
      p = r.json()
      docs.extend(p.get("documents", []))
      token = p.get("nextPageToken")
      if not token:
        break
    return docs

  def commit(self, writes):
    if not writes:
      return
    r = self.gs.req("POST", f"{self.base}:commit", json={"writes": writes})
    r.raise_for_status()

  def upsert(self, collection, doc_id, data):
    name = f"projects/{PROJECT_ID}/databases/(default)/documents/{collection}/{doc_id}"
    self.commit([{"update": {"name": name, "fields": fs_fields(data)}}])

  def upsert_merge(self, collection, doc_id, data):
    name = f"projects/{PROJECT_ID}/databases/(default)/documents/{collection}/{doc_id}"
    self.commit([{
      "update": {"name": name, "fields": fs_fields(data)},
      "updateMask": {"fieldPaths": list(data.keys())},
    }])


def mysql_conn():
  return pymysql.connect(
    host=MYSQL_HOST,
    port=MYSQL_PORT,
    user=MYSQL_USER,
    password=MYSQL_PASS,
    database=MYSQL_DB,
    charset="utf8mb4",
    cursorclass=pymysql.cursors.DictCursor,
    autocommit=True,
  )


def fetch_in(conn, base_sql, values):
  if not values:
    return []
  rows = []
  vals = list(values)
  with conn.cursor() as cur:
    for part in chunked(vals, 500):
      q = base_sql.replace("__IN__", ",".join(["%s"] * len(part)))
      cur.execute(q, part)
      rows.extend(cur.fetchall())
  return rows


def load_api_key():
  global API_KEY
  for line in Path(".env.production").read_text(encoding="utf-8").splitlines():
    if line.startswith("VITE_FIREBASE_API_KEY="):
      API_KEY = line.split("=", 1)[1].strip()
      break
  if not API_KEY:
    raise RuntimeError("VITE_FIREBASE_API_KEY missing")


def auth_lookup_uid(gs, email):
  url = f"https://identitytoolkit.googleapis.com/v1/projects/{PROJECT_ID}/accounts:lookup"
  r = gs.req("POST", url, json={"email": [email]})
  if r.status_code != 200:
    return None
  users = r.json().get("users", [])
  return users[0].get("localId") if users else None


def auth_signup(email, max_attempts=20):
  password = "Tmp#" + "".join(random.choice(string.ascii_letters + string.digits) for _ in range(12))
  url = f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={API_KEY}"
  last_error = ""
  for attempt in range(max_attempts):
    r = requests.post(url, json={"email": email, "password": password, "returnSecureToken": False}, timeout=30)
    if r.status_code == 200:
      return r.json().get("localId"), "created"
    msg = (r.json().get("error", {}) if r.text else {}).get("message", "")
    if msg == "EMAIL_EXISTS":
      return None, "exists"
    if "TOO_MANY_ATTEMPTS_TRY_LATER" in msg:
      wait_sec = min(300, 15 * (attempt + 1))
      print(f"[auth_signup] throttled for {email}; retrying in {wait_sec}s ({attempt + 1}/{max_attempts})")
      time.sleep(wait_sec)
      last_error = msg
      continue
    raise RuntimeError(f"Auth signup failed for {email}: {r.status_code} {r.text[:160]}")
  raise RuntimeError(f"Auth signup failed for {email}: {last_error or 'TOO_MANY_ATTEMPTS_TRY_LATER'}")


def send_reset(email):
  url = f"https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key={API_KEY}"
  requests.post(url, json={"requestType": "PASSWORD_RESET", "email": email}, timeout=20)


def to_ts(raw, fallback):
  if raw is None:
    return fallback
  if isinstance(raw, datetime):
    dt = raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
  s = normalize_text(raw)
  return s or fallback


def prepare():
  load_api_key()
  WORK_DIR.mkdir(exist_ok=True)
  gs = GoogleSession()
  fs = FirestoreRest(gs)
  existing_user_dir = {}
  for doc in fs.list_collection("userDirectory"):
    f = doc.get("fields", {})
    em = f.get("emailLower", f.get("email", {})).get("stringValue", "").lower()
    uid = f.get("userId", {}).get("stringValue", "")
    if em and uid:
      existing_user_dir[em] = uid

  conn = mysql_conn()
  with conn.cursor() as cur:
    cur.execute("SELECT idProy FROM PROYECTO WHERE fechaHora >= %s", (CUTOFF,))
    pset = {r["idProy"] for r in cur.fetchall()}
    cur.execute("SELECT idDocto FROM DOCUMENTO WHERE fechaModificacion >= %s", (CUTOFF,))
    dset = {r["idDocto"] for r in cur.fetchall()}
    cur.execute("SELECT idDocto FROM HILO WHERE fecha >= %s", (CUTOFF,))
    dset |= {r["idDocto"] for r in cur.fetchall()}
    cur.execute("SELECT idDocto FROM COMENTARIO WHERE fecha >= %s", (CUTOFF,))
    dset |= {r["idDocto"] for r in cur.fetchall()}
    cur.execute("SELECT idDocto FROM REVISORES WHERE fecha_hora >= %s", (CUTOFF,))
    dset |= {r["idDocto"] for r in cur.fetchall()}
    cur.execute("SELECT idProy FROM INTEGRANTE WHERE fecha_hora >= %s", (CUTOFF,))
    pset |= {r["idProy"] for r in cur.fetchall()}

  docs_rows = fetch_in(conn, "SELECT idDocto,idProy,version,titulo,fechaModificacion,idAutor,archivo,status,fechaLimite,fechaInicio FROM DOCUMENTO WHERE idDocto IN (__IN__)", dset)
  pset |= {r["idProy"] for r in docs_rows}
  proy_rows = fetch_in(conn, "SELECT idProy,nombre,fechaHora FROM PROYECTO WHERE idProy IN (__IN__)", pset)
  integ_rows = fetch_in(conn, "SELECT idUsuario,idProy,rol,fecha_hora FROM INTEGRANTE WHERE idProy IN (__IN__)", pset)
  rev_rows = fetch_in(conn, "SELECT idUsuario,idDocto,version,fecha_hora FROM REVISORES WHERE idDocto IN (__IN__)", {r["idDocto"] for r in docs_rows})
  hilo_rows = fetch_in(conn, "SELECT idHilo,idDocto,version,estatus,idUsuarioCerro,fecha,idUsuarioCreador FROM HILO WHERE idDocto IN (__IN__)", {r["idDocto"] for r in docs_rows})
  com_rows = fetch_in(conn, "SELECT numComentario,idHilo,contenido,fecha,idUsuario,idDocto,version FROM COMENTARIO WHERE idDocto IN (__IN__)", {r["idDocto"] for r in docs_rows})

  uids = set()
  for r in docs_rows:
    if r.get("idAutor"):
      uids.add(r["idAutor"])
  for table in (integ_rows, rev_rows, com_rows):
    for r in table:
      if r.get("idUsuario"):
        uids.add(r["idUsuario"])
  for r in hilo_rows:
    if r.get("idUsuarioCreador"):
      uids.add(r["idUsuarioCreador"])
    if r.get("idUsuarioCerro"):
      uids.add(r["idUsuarioCerro"])
  users_rows = fetch_in(conn, "SELECT idUsuario,nombre,aPaterno,aMaterno,email,tiempo FROM USUARIO WHERE idUsuario IN (__IN__)", uids)
  conn.close()

  user_by_id = {u["idUsuario"]: u for u in users_rows}
  email_groups = defaultdict(list)
  for uid in sorted(uids):
    email_groups[normalize_email(user_by_id.get(uid, {}).get("email"), uid)].append(uid)
  canonical_email = {}
  alias_map = {}
  for email, ids in email_groups.items():
    canonical = sorted(ids)[0]
    canonical_email[canonical] = email
    for i in ids:
      alias_map[i] = canonical

  email_to_uid = dict(existing_user_dir)
  created = 0
  for can_id, email in canonical_email.items():
    uid = email_to_uid.get(email)
    if not uid and is_legacy_placeholder_email(email):
      # Placeholder addresses are internal aliases; skip Firebase Auth signup.
      uid = local_uid_from_legacy_id(can_id)
      print(f"[prepare] using local uid for placeholder email: {email} -> {uid}")
    if not uid:
      uid = auth_lookup_uid(gs, email)
    if not uid:
      uid, state = auth_signup(email)
      if state == "exists":
        uid = auth_lookup_uid(gs, email)
      else:
        created += 1
      if uid:
        try:
          send_reset(email)
        except Exception:
          pass
    if not uid:
      raise RuntimeError(f"Cannot resolve uid for {email}")
    email_to_uid[email] = uid

  uid_map = {legacy: email_to_uid[canonical_email[can]] for legacy, can in alias_map.items()}

  prepared = build_payload(proy_rows, integ_rows, docs_rows, rev_rows, hilo_rows, com_rows, user_by_id, uid_map, canonical_email, email_to_uid, created)
  DATA_FILE.write_text(json.dumps(prepared, ensure_ascii=False), encoding="utf-8")
  print(json.dumps(prepared["meta"], ensure_ascii=False))


def build_payload(proy_rows, integ_rows, docs_rows, rev_rows, hilo_rows, com_rows, user_by_id, uid_map, canonical_email, email_to_uid, created_auth):
  proy_by_id = {p["idProy"]: p for p in proy_rows}
  docs_by_doc = defaultdict(list)
  for d in docs_rows:
    docs_by_doc[d["idDocto"]].append(d)
  proj_short = {}
  next_ps = 1
  for pid in sorted(proy_by_id.keys()):
    t = normalize_text(pid)
    if t.isdigit():
      proj_short[pid] = int(t)
    else:
      proj_short[pid] = next_ps
      next_ps += 1

  members_by_project = defaultdict(list)
  for m in integ_rows:
    members_by_project[m["idProy"]].append(m)
  leader_by_project = {}
  for pid, members in members_by_project.items():
    leader = None
    for m in members:
      rr = normalize_role_text(m.get("rol"))
      if "lider" in rr or "leader" in rr:
        leader = uid_map.get(m.get("idUsuario"))
        if leader:
          break
    if not leader and members:
      leader = uid_map.get(members[0].get("idUsuario"))
    leader_by_project[pid] = leader or (next(iter(uid_map.values())) if uid_map else "")

  collections = {k: {} for k in ["userProfiles", "userDirectory", "projects", "projectMembers", "documents", "versions", "threads", "comments", "counters"]}
  file_tasks = []

  for can_id, email in canonical_email.items():
    uid = email_to_uid[email]
    u = user_by_id.get(can_id, {})
    display = " ".join([normalize_text(u.get("nombre")), normalize_text(u.get("aPaterno")), normalize_text(u.get("aMaterno"))]).strip() or can_id
    is_admin = email in ADMIN_EMAILS
    collections["userProfiles"][uid] = {
      "email": email, "displayName": display, "isAdmin": is_admin, "isActive": True,
      "roles": ["admin"] if is_admin else ["member"], "createdAt": to_ts(u.get("tiempo"), "2025-07-01T00:00:00Z"),
      "updatedAt": now_iso(), "createdBy": uid, "updatedBy": uid
    }
    collections["userDirectory"][email] = {
      "email": email, "emailLower": email, "emailKey": email, "userId": uid, "displayName": display, "updatedAt": now_iso()
    }

  reviewers = defaultdict(list)
  for r in rev_rows:
    uid = uid_map.get(r.get("idUsuario"))
    if uid:
      key = (r.get("idDocto"), normalize_text(r.get("version")))
      if uid not in reviewers[key]:
        reviewers[key].append(uid)

  version_idx = {}
  thread_idx = {}
  for doc_id, vers in docs_by_doc.items():
    vers_sorted = sorted(vers, key=lambda x: version_to_int(x.get("version")) or -1)
    pid = vers_sorted[0]["idProy"]
    proj_id = f"legacy:{pid}"
    collections["projects"][proj_id] = collections["projects"].get(proj_id) or {
      "name": normalize_text(proy_by_id.get(pid, {}).get("nombre")) or f"Legacy Project {pid}",
      "leaderId": leader_by_project.get(pid, ""),
      "shortId": proj_short.get(pid, 1),
      "isActive": True,
      "createdAt": to_ts(proy_by_id.get(pid, {}).get("fechaHora"), "2025-07-01T00:00:00Z"),
      "updatedAt": to_ts(proy_by_id.get(pid, {}).get("fechaHora"), "2025-07-01T00:00:00Z"),
      "createdBy": leader_by_project.get(pid, ""),
      "updatedBy": leader_by_project.get(pid, ""),
    }
    suffix = doc_id.split("-")[-1] if "-" in doc_id else ""
    short_id = int(suffix) if suffix.isdigit() else 1
    doc_ref = f"legacy:{pid}:{doc_id}"
    first, latest = vers_sorted[0], vers_sorted[-1]
    creator = uid_map.get(first.get("idAutor")) or leader_by_project.get(pid, "")
    collections["documents"][doc_ref] = {
      "projectId": proj_id, "title": normalize_text(latest.get("titulo")) or f"Legacy Document {doc_id}",
      "shortId": short_id, "createdBy": creator, "createdAt": to_ts(first.get("fechaInicio") or first.get("fechaModificacion"), "2025-07-01T00:00:00Z"),
      "updatedAt": to_ts(latest.get("fechaModificacion"), "2025-07-01T00:00:00Z"), "updatedBy": creator, "type": "document", "isActive": True
    }
    prev = None
    for v in vers_sorted:
      num = version_to_int(v.get("version"))
      if num is None:
        continue
      vlegacy = normalize_text(v.get("version"))
      vid = f"legacy:{pid}:{doc_id}:{vlegacy}"
      version_idx[(doc_id, vlegacy)] = vid
      author = uid_map.get(v.get("idAutor")) or creator
      collections["versions"][vid] = {
        "projectId": proj_id, "docId": doc_ref, "number": num, "status": normalize_status(v.get("status")),
        "createdBy": author, "reviewerIds": reviewers.get((doc_id, vlegacy), []),
        "reviewStartAt": to_ts(v.get("fechaInicio"), "2025-07-01T00:00:00Z"),
        "reviewEndAt": to_ts(v.get("fechaLimite"), "2025-07-01T00:00:00Z"),
        "createdAt": to_ts(v.get("fechaInicio") or v.get("fechaModificacion"), "2025-07-01T00:00:00Z"),
        "updatedAt": to_ts(v.get("fechaModificacion"), "2025-07-01T00:00:00Z"), "updatedBy": author,
        "hasFile": False, "fileRefId": None, "acceptedErrorReportId": None, "previousVersionId": prev,
        "stats": {"numThreads": 0, "numOpenThreads": 0, "numComments": 0, "numThreadsWithTwoPlusComments": 0},
        "numThreads": 0, "numOpenThreads": 0, "numComments": 0, "numThreadsWithTwoPlusComments": 0,
      }
      fname = normalize_text(v.get("archivo"))
      if fname:
        file_tasks.append({"projectLegacyId": pid, "docLegacyId": doc_id, "versionLegacy": vlegacy, "versionId": vid, "docId": doc_ref, "projectId": proj_id, "fileName": fname, "createdBy": author, "createdAt": to_ts(v.get("fechaModificacion"), "2025-07-01T00:00:00Z")})
      prev = vid

  for h in hilo_rows:
    doc_id = h.get("idDocto")
    vlegacy = normalize_text(h.get("version"))
    base = docs_by_doc.get(doc_id, [])
    if not base:
      continue
    pid = base[0]["idProy"]
    proj_id = f"legacy:{pid}"
    doc_ref = f"legacy:{pid}:{doc_id}"
    vid = version_idx.get((doc_id, vlegacy))
    if not vid:
      continue
    tid = f"legacy:{pid}:{doc_id}:{vlegacy}:{h.get('idHilo')}"
    thread_idx[(doc_id, vlegacy, int(h.get("idHilo")))] = tid
    creator = uid_map.get(h.get("idUsuarioCreador")) or uid_map.get(h.get("idUsuarioCerro")) or ""
    status = normalize_thread_status(h.get("estatus"))
    collections["threads"][tid] = {
      "projectId": proj_id, "docId": doc_ref, "versionId": vid, "title": f"Legacy thread {h.get('idHilo')}",
      "status": status, "createdBy": creator, "createdAt": to_ts(h.get("fecha"), "2025-07-01T00:00:00Z"),
      "updatedAt": to_ts(h.get("fecha"), "2025-07-01T00:00:00Z"), "updatedBy": creator,
      "closedBy": uid_map.get(h.get("idUsuarioCerro")) if status == "closed" else None,
      "closedAt": to_ts(h.get("fecha"), "2025-07-01T00:00:00Z") if status == "closed" else None,
      "reopenedBy": None, "reopenedAt": None, "commentCount": 0, "lastCommentAt": None, "lastCommentBy": None,
    }

  for c in com_rows:
    doc_id = c.get("idDocto")
    vlegacy = normalize_text(c.get("version"))
    base = docs_by_doc.get(doc_id, [])
    if not base:
      continue
    pid = base[0]["idProy"]
    proj_id = f"legacy:{pid}"
    doc_ref = f"legacy:{pid}:{doc_id}"
    vid = version_idx.get((doc_id, vlegacy))
    tid = thread_idx.get((doc_id, vlegacy, int(c.get("idHilo"))))
    if not vid or not tid:
      continue
    cid = f"legacy:{pid}:{doc_id}:{vlegacy}:{c.get('idHilo')}:{c.get('numComentario')}"
    collections["comments"][cid] = {
      "projectId": proj_id, "docId": doc_ref, "versionId": vid, "threadId": tid,
      "body": normalize_text(c.get("contenido")) or "(legacy empty comment)", "createdBy": uid_map.get(c.get("idUsuario")) or "",
      "createdAt": to_ts(c.get("fecha"), "2025-07-01T00:00:00Z"), "updatedAt": to_ts(c.get("fecha"), "2025-07-01T00:00:00Z"), "updatedBy": uid_map.get(c.get("idUsuario")) or "",
    }

  max_short = max([p.get("shortId", 0) for p in collections["projects"].values()] or [0])
  collections["counters"]["projects"] = {"nextNumber": max_short + 1, "lastProjectId": sorted(collections["projects"].keys())[-1] if collections["projects"] else ""}
  for pid, pdoc in collections["projects"].items():
    docs = [d for d in collections["documents"].values() if d["projectId"] == pid]
    collections["counters"][f"documents_{pid}"] = {"projectId": pid, "nextNumber": max([d.get("shortId", 0) for d in docs] or [0]) + 1}
  by_doc = defaultdict(list)
  for vid, v in collections["versions"].items():
    by_doc[v["docId"]].append((vid, v))
  for did, arr in by_doc.items():
    arrs = sorted(arr, key=lambda x: x[1]["number"])
    collections["counters"][f"versions_{did}"] = {"docId": did, "projectId": arrs[-1][1]["projectId"], "nextNumber": arrs[-1][1]["number"] + 1, "previousVersionId": arrs[-1][0]}

  for m in integ_rows:
    pid = f"legacy:{m['idProy']}"
    uid = uid_map.get(m.get("idUsuario"))
    if not uid:
      continue
    rr = normalize_role_text(m.get("rol"))
    role = "leader" if ("lider" in rr or "leader" in rr) else "member"
    collections["projectMembers"][f"{pid}_{uid}"] = {"projectId": pid, "userId": uid, "role": role, "createdAt": to_ts(m.get("fecha_hora"), "2025-07-01T00:00:00Z"), "updatedAt": to_ts(m.get("fecha_hora"), "2025-07-01T00:00:00Z"), "createdBy": uid, "updatedBy": uid}

  return {
    "meta": {"preparedAt": now_iso(), "createdAuthUsers": created_auth, "counts": {k: len(v) for k, v in collections.items()} | {"fileTasks": len(file_tasks)}},
    "collections": collections,
    "fileTasks": file_tasks,
  }


def load_prepared():
  if not DATA_FILE.exists():
    raise RuntimeError("Run prepare first")
  return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def run_cmd(cmd):
  if cmd and cmd[0] == "firebase":
    fb = shutil.which("firebase") or shutil.which("firebase.cmd")
    if not fb:
      appdata = os.environ.get("APPDATA", "")
      cand = os.path.join(appdata, "npm", "firebase.cmd") if appdata else ""
      if cand and os.path.exists(cand):
        fb = cand
    if not fb:
      raise RuntimeError("firebase CLI not found in PATH")
    cmd = [fb] + cmd[1:]
  print("[cmd]", " ".join(cmd))
  subprocess.run(cmd, check=True)


def wipe_core():
  for coll in ["projects", "projectMembers", "documents", "versions", "threads", "comments", "files", "counters"]:
    run_cmd(["firebase", "firestore:delete", "--project", PROJECT_ID, "--recursive", "--force", coll])
  print("[wipe_core] done")


def load_core():
  p = load_prepared()
  gs, fs = GoogleSession(), FirestoreRest(GoogleSession())
  fs = FirestoreRest(gs)
  order = ["userProfiles", "userDirectory", "projects", "projectMembers", "documents", "versions", "threads", "comments", "counters"]
  for coll in order:
    items = list(p["collections"][coll].items())
    total, done = len(items), 0
    for part in chunked(items, 200):
      writes = []
      for doc_id, data in part:
        name = f"projects/{PROJECT_ID}/databases/(default)/documents/{coll}/{doc_id}"
        writes.append({"update": {"name": name, "fields": fs_fields(data)}})
      fs.commit(writes)
      done += len(part)
      if done % 1000 == 0 or done == total:
        print(f"[load_core] {coll}: {done}/{total}")
  print("[load_core] done")


def safe_component(value):
  return re.sub(r"[^a-zA-Z0-9._-]", "_", normalize_text(value))


def storage_upload(gs, bucket, object_name, data_bytes, content_type):
  import urllib.parse
  url = f"https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name={urllib.parse.quote(object_name, safe='')}"
  r = gs.req("POST", url, data=data_bytes, headers={"Content-Type": content_type or "application/octet-stream"})
  r.raise_for_status()


def upload_files(max_seconds):
  p = load_prepared()
  tasks = p.get("fileTasks", [])
  gs, fs = GoogleSession(), FirestoreRest(GoogleSession())
  fs = FirestoreRest(gs)
  bucket = "qualiteam-app.firebasestorage.app"
  state = {"nextIndex": 0, "uploaded": 0, "missing": 0, "errors": 0}
  if UPLOAD_STATE_FILE.exists():
    state.update(json.loads(UPLOAD_STATE_FILE.read_text(encoding="utf-8")))
  i, start, processed = int(state["nextIndex"]), time.time(), 0
  t = paramiko.Transport((SSH_HOST, SSH_PORT))
  t.connect(username=SSH_USER, password=SSH_PASS)
  sftp = paramiko.SFTPClient.from_transport(t)
  try:
    while i < len(tasks):
      if time.time() - start >= max_seconds:
        break
      task = tasks[i]
      remote = f"{LEGACY_FILES_DIR}/{task['fileName']}"
      try:
        with sftp.file(remote, "rb") as rf:
          data = rf.read()
      except FileNotFoundError:
        state["missing"] += 1
        fs.upsert_merge("versions", task["versionId"], {"hasFile": False, "fileRefId": None, "updatedAt": now_iso(), "updatedBy": task["createdBy"]})
        i += 1
        processed += 1
        continue
      except Exception:
        state["errors"] += 1
        i += 1
        processed += 1
        continue
      file_doc_id = f"legacy-file:{task['projectLegacyId']}:{task['docLegacyId']}:{task['versionLegacy']}"
      key = f"qt4/{safe_component(task['projectLegacyId'])}/{safe_component(task['docLegacyId'])}/{safe_component(task['versionLegacy'])}/{safe_component(task['fileName'])}"
      ctype = mimetypes.guess_type(task["fileName"])[0] or "application/octet-stream"
      try:
        storage_upload(gs, bucket, key, data, ctype)
        fs.upsert("files", file_doc_id, {
          "projectId": task["projectId"], "docId": task["docId"], "versionId": task["versionId"], "fileKey": key, "fileName": task["fileName"],
          "contentType": ctype, "sizeBytes": len(data), "isPermanent": True, "expireAfterDays": None, "storageProvider": "firebase-storage",
          "createdBy": task["createdBy"], "createdAt": task["createdAt"], "updatedBy": task["createdBy"], "updatedAt": now_iso()
        })
        fs.upsert_merge("versions", task["versionId"], {"hasFile": True, "fileRefId": file_doc_id, "updatedAt": now_iso(), "updatedBy": task["createdBy"]})
        state["uploaded"] += 1
      except Exception:
        state["errors"] += 1
      i += 1
      processed += 1
      if processed % 25 == 0:
        elapsed = max(1.0, time.time() - start)
        rate = processed / elapsed
        remain = len(tasks) - i
        eta = int(remain / rate) if rate > 0 else 0
        print(f"[upload_files] processed={processed} index={i}/{len(tasks)} remain={remain} etaSec={eta}")
  finally:
    sftp.close()
    t.close()
  state["nextIndex"] = i
  UPLOAD_STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
  print(json.dumps({"processedThisRun": processed, "nextIndex": i, "totalTasks": len(tasks), **state}, ensure_ascii=False))


def finalize():
  gs, fs = GoogleSession(), FirestoreRest(GoogleSession())
  fs = FirestoreRest(gs)
  fs.upsert("systemConfig", "runtime", {
    "fileStorageProvider": "firebase-storage",
    "emailProvider": "firebase-functions",
    "updatedAt": now_iso(),
    "updatedBy": "7yfVJmWAwYUacDkr1eu5n5t2zqM2",
  })
  print("[finalize] runtime updated")


def status():
  p = load_prepared()
  st = json.loads(UPLOAD_STATE_FILE.read_text(encoding="utf-8")) if UPLOAD_STATE_FILE.exists() else None
  print(json.dumps({"preparedCounts": p["meta"]["counts"], "uploadState": st, "timestamp": now_iso()}, ensure_ascii=False, indent=2))


def main():
  ap = argparse.ArgumentParser()
  sub = ap.add_subparsers(dest="cmd", required=True)
  sub.add_parser("prepare")
  sub.add_parser("wipe_core")
  sub.add_parser("load_core")
  up = sub.add_parser("upload_files")
  up.add_argument("--max-seconds", type=int, default=900)
  sub.add_parser("finalize")
  sub.add_parser("status")
  a = ap.parse_args()
  if a.cmd == "prepare":
    prepare()
  elif a.cmd == "wipe_core":
    wipe_core()
  elif a.cmd == "load_core":
    load_core()
  elif a.cmd == "upload_files":
    upload_files(a.max_seconds)
  elif a.cmd == "finalize":
    finalize()
  elif a.cmd == "status":
    status()


if __name__ == "__main__":
  main()
