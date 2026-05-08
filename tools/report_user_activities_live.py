#!/usr/bin/env python3
import argparse
import csv
import json
import os
import logging
from collections import defaultdict
from pathlib import Path

import pymysql
import requests

PROJECT_ID = "qualiteam-app"
MYSQL_HOST = os.getenv( "QT4_LEGACY_MYSQL_HOST", "qualiteam.cua.uam.mx" )
MYSQL_PORT = int( os.getenv( "QT4_LEGACY_MYSQL_PORT", "3306" ) )
MYSQL_DB = os.getenv( "QT4_LEGACY_MYSQL_DB", "qualiteam" )
MYSQL_USER = os.getenv( "QT4_LEGACY_MYSQL_USER", "" )
MYSQL_PASS = os.getenv( "QT4_LEGACY_MYSQL_PASS", "" )
DEFAULT_PROJECTS = [ 342, 345, 347, 348, 349, 350, 351, 359 ]


def setup_logging():
  logging.basicConfig(
    level=logging.INFO,
    format='[%(levelname)s] %(message)s',
  )


def parse_args():
  parser = argparse.ArgumentParser(
    description="Generate one CSV per user with all activities, one row per activity.",
  )
  parser.add_argument(
    "--projects",
    default=",".join( str( project ) for project in DEFAULT_PROJECTS ),
    help="Comma-separated project short IDs to include.",
  )
  parser.add_argument(
    "--output-dir",
    default="user_activity_reports",
    help="Directory where per-user CSV files will be written.",
  )
  parser.add_argument(
    "--allowed-emails-file",
    action="append",
    default=[ str( Path( __file__ ).with_name( "allowed_student_emails.txt" ) ) ],
    help="Path to a text file containing allowed students; emails are extracted from the text. Can be passed multiple times.",
  )
  return parser.parse_args()


def qt4_project_ids_from_short_ids(short_ids):
  return { f"legacy:{project_id}" for project_id in short_ids }


def legacy_project_ids_from_short_ids(short_ids):
  return { int( project_id ) for project_id in short_ids }


def chunked(items, size):
  for index in range( 0, len( items ), size ):
    yield items[index:index + size]


def mysql_conn():
  logging.info( 'Connecting to legacy MySQL at %s:%s/%s as %s', MYSQL_HOST, MYSQL_PORT, MYSQL_DB, MYSQL_USER or '<empty>' )
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
  vals = list( values )
  with conn.cursor() as cur:
    for part in chunked( vals, 500 ):
      q = base_sql.replace( "__IN__", ",".join( [ "%s" ] * len( part ) ) )
      cur.execute( q, part )
      rows.extend( cur.fetchall() )
  return rows


def firebase_tokens():
  logging.info( 'Reading Firebase token cache' )
  cfg = json.loads( ( Path.home() / ".config" / "configstore" / "firebase-tools.json" ).read_text( encoding="utf-8" ) )
  tokens = cfg.get( "tokens", {} )
  client = json.loads(
    __import__( "subprocess" ).check_output(
      [
        "node",
        "-e",
        "const api=require(process.env.APPDATA+'\\\\npm\\\\node_modules\\\\firebase-tools\\\\lib\\\\api'); console.log(JSON.stringify({id:api.clientId(),secret:api.clientSecret()}));",
      ],
      text=True,
    ).strip()
  )
  return {
    "access_token": tokens.get( "access_token", "" ),
    "refresh_token": tokens.get( "refresh_token", "" ),
    "expires_at": int( tokens.get( "expires_at", 0 ) ),
    "client_id": client["id"],
    "client_secret": client["secret"],
  }


class GoogleSession:
  def __init__( self ):
    self.t = firebase_tokens()
    self.s = requests.Session()

  def refresh( self ):
    logging.info( 'Refreshing Google access token' )
    payload = {
      "grant_type": "refresh_token",
      "refresh_token": self.t["refresh_token"],
      "client_id": self.t["client_id"],
      "client_secret": self.t["client_secret"],
    }
    r = self.s.post( "https://www.googleapis.com/oauth2/v3/token", data=payload, timeout=30 )
    r.raise_for_status()
    d = r.json()
    self.t["access_token"] = d["access_token"]
    self.t["expires_at"] = 0

  def req( self, method, url, **kwargs ):
    headers = kwargs.pop( "headers", {} )
    headers["Authorization"] = f"Bearer {self.t['access_token']}"
    r = self.s.request( method, url, headers=headers, timeout=60, **kwargs )
    if r.status_code == 401:
      self.refresh()
      headers["Authorization"] = f"Bearer {self.t['access_token']}"
      r = self.s.request( method, url, headers=headers, timeout=60, **kwargs )
    r.raise_for_status()
    return r


class FirestoreRest:
  def __init__( self, gs ):
    self.gs = gs
    self.base = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents"

  def list_collection( self, collection ):
    logging.info( 'Loading Firestore collection: %s', collection )
    docs, token = [], None
    while True:
      url = f"{self.base}/{collection}?pageSize=500"
      if token:
        url += f"&pageToken={token}"
      r = self.gs.req( "GET", url )
      p = r.json()
      docs.extend( p.get( "documents", [] ) )
      token = p.get( "nextPageToken" )
      if not token:
        break
    return docs


def fs_value_to_py(value):
  if "stringValue" in value:
    return value["stringValue"]
  if "integerValue" in value:
    return int( value["integerValue"] )
  if "doubleValue" in value:
    return float( value["doubleValue"] )
  if "booleanValue" in value:
    return bool( value["booleanValue"] )
  if "timestampValue" in value:
    return value["timestampValue"]
  if "nullValue" in value:
    return None
  if "mapValue" in value:
    fields = value.get( "mapValue", {} ).get( "fields", {} )
    return { k: fs_value_to_py( v ) for k, v in fields.items() }
  if "arrayValue" in value:
    values = value.get( "arrayValue", {} ).get( "values", [] )
    return [ fs_value_to_py( v ) for v in values ]
  return None


def doc_to_dict(doc):
  return { k: fs_value_to_py( v ) for k, v in doc.get( "fields", {} ).items() }


def one_line_text(value):
  if value is None:
    return ""
  return " ".join( str( value ).split() )


def json_safe(value):
  if isinstance( value, dict ):
    return { k: json_safe( v ) for k, v in value.items() }
  if isinstance( value, list ):
    return [ json_safe( v ) for v in value ]
  if hasattr( value, "isoformat" ):
    return value.isoformat()
  return value


def normalized_timestamp(value):
  if value is None:
    return ""
  if hasattr( value, "isoformat" ):
    return value.isoformat()
  return one_line_text( value )


def safe_filename(value):
  text = one_line_text( value )
  keep = []
  for ch in text:
    if ch.isalnum() or ch in ( " ", "-", "_" ):
      keep.append( ch )
    else:
      keep.append( "_" )
  text = "".join( keep ).strip().replace( " ", "_" )
  while "__" in text:
    text = text.replace( "__", "_" )
  return text or "user"


def normalize_email_key(value):
  text = one_line_text( value ).lower()
  return text or ""


def extract_emails_from_text(text):
  emails = set()
  for token in text.replace( ";", " " ).replace( ",", " " ).split():
    cleaned = token.strip().lower()
    if "@" in cleaned and "." in cleaned:
      emails.add( cleaned )
  return emails


def load_allowed_emails(paths):
  allowed = set()
  for raw_path in paths:
    path = Path( raw_path )
    if not path.exists():
      logging.warning( 'Allowed emails file not found: %s', path )
      continue
    allowed.update( extract_emails_from_text( path.read_text( encoding="utf-8" ) ) )
  allowed.add( "jorge.cervantes.ojeda@gmail.com" )
  return allowed


def load_live_firestore():
  logging.info( 'Loading live Firestore data' )
  gs = GoogleSession()
  fs = FirestoreRest( gs )
  collections = {
    "userProfiles": {},
    "projects": {},
    "projectMembers": {},
    "documents": {},
    "versions": {},
    "threads": {},
    "comments": {},
    "changeRequests": {},
    "testProcedures": {},
    "testLogs": {},
    "testDesigns": {},
    "testCases": {},
    "auditLogs": {},
  }
  for name in collections:
    for doc in fs.list_collection( name ):
      collections[name][doc["name"].split( "/" )[-1]] = doc_to_dict( doc )
    logging.info( 'Loaded %s docs from %s', len( collections[name] ), name )
  return collections


def load_legacy_rows(project_ids):
  logging.info( 'Loading legacy rows for project IDs: %s', ','.join( str( p ) for p in sorted( project_ids ) ) )
  conn = mysql_conn()
  with conn.cursor() as cur:
    logging.info( 'Loading legacy users' )
    cur.execute( "SELECT idUsuario,nombre,aPaterno,aMaterno,email FROM USUARIO" )
    users = { r["idUsuario"]: r for r in cur.fetchall() }
  logging.info( 'Loaded %s legacy users', len( users ) )

  logging.info( 'Loading legacy documents' )
  docs = fetch_in( conn, "SELECT idDocto,idProy,version,titulo,fechaModificacion,idAutor,status FROM DOCUMENTO WHERE idProy IN (__IN__)", project_ids )
  logging.info( 'Loaded %s legacy documents', len( docs ) )
  doc_by_id = { r["idDocto"]: r for r in docs }
  logging.info( 'Loading legacy threads/comments/members/reviewers/special documents' )
  hilo_rows = fetch_in( conn, "SELECT idHilo,idDocto,version,estatus,idUsuarioCerro,fecha,idUsuarioCreador FROM HILO WHERE idDocto IN (SELECT idDocto FROM DOCUMENTO WHERE idProy IN (__IN__))", project_ids )
  com_rows = fetch_in( conn, "SELECT numComentario,idHilo,contenido,fecha,idUsuario,idDocto,version FROM COMENTARIO WHERE idDocto IN (SELECT idDocto FROM DOCUMENTO WHERE idProy IN (__IN__))", project_ids )
  integ_rows = fetch_in( conn, "SELECT idUsuario,idProy,rol,fecha_hora FROM INTEGRANTE WHERE idProy IN (__IN__)", project_ids )
  rev_rows = fetch_in( conn, "SELECT idUsuario,idDocto,version,fecha_hora,calificacion FROM REVISORES WHERE idDocto IN (SELECT idDocto FROM DOCUMENTO WHERE idProy IN (__IN__))", project_ids )
  tr_rows = fetch_in( conn, "SELECT idTRecord,idProy,idDoctoBase,versionDoctoBase,fecha_hora FROM reportedeerror WHERE idProy IN (__IN__)", project_ids )
  cr_rows = fetch_in( conn, "SELECT idSolicCambio,idProy,idDoctoBase,idProyBase,versionDoctoBase,fecha_hora FROM solicituddecambio WHERE idProy IN (__IN__)", project_ids )
  proc_rows = fetch_in( conn, "SELECT idProc,idProy,fecha_hora FROM procedimientodeprueba WHERE idProy IN (__IN__)", project_ids )
  tlog_rows = fetch_in( conn, "SELECT idTestLog,idProy,fecha_hora FROM testlog WHERE idProy IN (__IN__)", project_ids )
  dsn_rows = fetch_in( conn, "SELECT idDiseno,idProy,fecha_hora FROM disenodeprueba WHERE idProy IN (__IN__)", project_ids )
  case_rows = fetch_in( conn, "SELECT idCaso,idDiseno,idProc,idProy,fecha_hora FROM casosdeprueba WHERE idProy IN (__IN__)", project_ids )
  logging.info(
    'Legacy row counts: integrations=%s documents=%s threads=%s comments=%s reviewers=%s errorReports=%s changeRequests=%s procedures=%s testLogs=%s designs=%s cases=%s',
    len( integ_rows ), len( docs ), len( hilo_rows ), len( com_rows ), len( rev_rows ), len( tr_rows ), len( cr_rows ), len( proc_rows ), len( tlog_rows ), len( dsn_rows ), len( case_rows ),
  )
  conn.close()

  rows = []
  for r in integ_rows:
    email = users.get( r["idUsuario"], {} ).get( "email", "" )
    email_key = normalize_email_key( email ) or f"legacy:{r['idUsuario']}"
    rows.append( {
      "source": "legacy",
      "activityType": "project_membership",
      "projectId": r["idProy"],
      "entityId": f"{r['idProy']}:{r['idUsuario']}",
      "entityLabel": r["rol"],
      "userId": r["idUsuario"],
      "userName": format_legacy_user( users.get( r["idUsuario"] ) ),
      "email": email,
      "userKey": email_key,
      "timestamp": normalized_timestamp( r["fecha_hora"] ),
      "details": json.dumps( json_safe( r ), ensure_ascii=False ),
    } )
  for r in docs:
    email = users.get( r.get( "idAutor", "" ), {} ).get( "email", "" )
    email_key = normalize_email_key( email ) or f"legacy:{r.get('idAutor','')}"
    rows.append( {
      "source": "legacy",
      "activityType": "document_created_updated",
      "projectId": r["idProy"],
      "entityId": r["idDocto"],
      "entityLabel": r.get( "titulo", "" ),
      "userId": r.get( "idAutor", "" ),
      "userName": format_legacy_user( users.get( r.get( "idAutor", "" ) ) ),
      "email": email,
      "userKey": email_key,
      "timestamp": normalized_timestamp( r.get( "fechaModificacion", "" ) ),
      "details": json.dumps( json_safe( r ), ensure_ascii=False ),
    } )
  for r in hilo_rows:
    for field, activity_type in ( ( "idUsuarioCreador", "thread_created" ), ( "idUsuarioCerro", "thread_closed" ) ):
      uid = r.get( field )
      if uid:
        email = users.get( uid, {} ).get( "email", "" )
        email_key = normalize_email_key( email ) or f"legacy:{uid}"
        rows.append( {
          "source": "legacy",
          "activityType": activity_type,
          "projectId": doc_by_id.get( r["idDocto"], {} ).get( "idProy", "" ),
          "entityId": r["idHilo"],
          "entityLabel": r["idDocto"],
          "userId": uid,
          "userName": format_legacy_user( users.get( uid ) ),
          "email": email,
          "userKey": email_key,
          "timestamp": normalized_timestamp( r.get( "fecha", "" ) ),
          "details": json.dumps( json_safe( r ), ensure_ascii=False ),
        } )
  for r in com_rows:
    email = users.get( r.get( "idUsuario", "" ), {} ).get( "email", "" )
    email_key = normalize_email_key( email ) or f"legacy:{r.get('idUsuario','')}"
    rows.append( {
      "source": "legacy",
      "activityType": "comment_created",
      "projectId": r["idDocto"].split( ":" )[0] if r.get( "idDocto" ) else "",
      "entityId": f"{r['idHilo']}:{r['numComentario']}",
      "entityLabel": one_line_text( r.get( "contenido", "" ) ),
      "userId": r.get( "idUsuario", "" ),
      "userName": format_legacy_user( users.get( r.get( "idUsuario", "" ) ) ),
      "email": email,
      "userKey": email_key,
      "timestamp": normalized_timestamp( r.get( "fecha", "" ) ),
      "details": json.dumps( {
        **json_safe( r ),
        "contenido": one_line_text( r.get( "contenido", "" ) ),
      }, ensure_ascii=False ),
    } )
  for table, label, uid_field in [
    ( tr_rows, "error_report_created", None ),
    ( cr_rows, "change_request_created", None ),
    ( proc_rows, "test_procedure_created", None ),
    ( tlog_rows, "test_log_created", None ),
    ( dsn_rows, "test_design_created", None ),
    ( case_rows, "test_case_created", None ),
  ]:
    for r in table:
      user_id = next( ( v for k, v in r.items() if k.startswith( "idUsuario" ) and v ), "" )
      email = users.get( user_id, {} ).get( "email", "" )
      email_key = normalize_email_key( email ) or f"legacy:{user_id}"
      rows.append( {
        "source": "legacy",
        "activityType": label,
        "projectId": r.get( "idProy", "" ),
        "entityId": next( ( r[k] for k in r.keys() if k.startswith( "id" ) and k != "idProy" ), "" ),
        "entityLabel": "",
        "userId": user_id,
        "userName": format_legacy_user( users.get( user_id ) ),
        "email": email,
        "userKey": email_key,
        "timestamp": r.get( "fecha_hora", "" ),
        "details": json.dumps( json_safe( r ), ensure_ascii=False ),
      } )
  return rows


def format_legacy_user(user_row):
  if not user_row:
    return ""
  parts = [ user_row.get( "nombre", "" ), user_row.get( "aPaterno", "" ), user_row.get( "aMaterno", "" ) ]
  return " ".join( part for part in parts if part ).strip() or user_row.get( "email", "" ) or ""


def load_qt4_rows(collections, project_ids):
  logging.info( 'Loading QT4 rows for project IDs: %s', ','.join( sorted( project_ids ) ) )
  profiles = collections.get( "userProfiles", {} )
  user_name = { uid: ( profile.get( "displayName" ) or profile.get( "email" ) or uid ) for uid, profile in profiles.items() }
  user_email = { uid: ( profile.get( "email" ) or "" ) for uid, profile in profiles.items() }
  rows = []

  for row in collections.get( "projectMembers", {} ).values():
    if row.get( "projectId" ) in project_ids:
      uid = row.get( "userId" )
      email = user_email.get( uid, "" )
      email_key = normalize_email_key( email ) or f"qt4:{uid}"
      rows.append( {
        "source": "qt4",
        "activityType": "project_membership",
        "projectId": row.get( "projectId", "" ),
        "entityId": f"{row.get('projectId','')}:{uid}",
        "entityLabel": row.get( "role", "" ),
        "userId": uid,
        "userName": user_name.get( uid, uid or "" ),
        "email": email,
        "userKey": email_key,
        "timestamp": normalized_timestamp( row.get( "createdAt", "" ) ),
        "details": json.dumps( row, ensure_ascii=False ),
      } )

  def add_rows(coll_name, activity_type, user_fields, label_field=None):
    for doc_id, row in collections.get( coll_name, {} ).items():
      if row.get( "projectId" ) not in project_ids:
        continue
      for field in user_fields:
        uid = row.get( field )
        if uid:
          email = user_email.get( uid, "" )
          email_key = normalize_email_key( email ) or f"qt4:{uid}"
          rows.append( {
            "source": "qt4",
            "activityType": activity_type,
            "projectId": row.get( "projectId", "" ),
            "entityId": doc_id,
            "entityLabel": one_line_text( row.get( label_field, "" ) ) if label_field else "",
            "userId": uid,
            "userName": user_name.get( uid, uid ),
            "email": email,
            "userKey": email_key,
            "timestamp": normalized_timestamp( row.get( "createdAt", "" ) or row.get( "updatedAt", "" ) ),
            "details": json.dumps( {
              **json_safe( row ),
              **( { label_field: one_line_text( row.get( label_field, "" ) ) } if label_field else {} ),
            }, ensure_ascii=False ),
          } )

  add_rows( "documents", "document_created", [ "createdBy" ], "title" )
  add_rows( "documents", "document_updated", [ "updatedBy" ], "title" )
  add_rows( "versions", "version_created", [ "createdBy" ], "docId" )
  add_rows( "versions", "version_updated", [ "updatedBy" ], "docId" )
  add_rows( "threads", "thread_created", [ "createdBy" ], "docId" )
  add_rows( "threads", "thread_closed", [ "closedBy" ], "docId" )
  add_rows( "comments", "comment_created", [ "createdBy" ], "body" )
  add_rows( "changeRequests", "change_request_created", [ "createdBy" ], "title" )
  add_rows( "testProcedures", "test_procedure_created", [ "createdBy" ], "title" )
  add_rows( "testLogs", "test_log_created", [ "createdBy" ], "title" )
  add_rows( "testDesigns", "test_design_created", [ "createdBy" ], "title" )
  add_rows( "testCases", "test_case_created", [ "createdBy" ], "title" )
  add_rows( "auditLogs", "audit_event", [ "actorId" ], "action" )
  logging.info( 'QT4 rows generated: %s', len( rows ) )
  return rows


def write_user_files(rows, output_dir):
  logging.info( 'Writing per-user CSV files into %s', output_dir )
  by_user = defaultdict( list )
  user_name_by_key = {}
  for row in rows:
    key = row.get( "userKey" ) or row.get( "email" ) or row.get( "userId" )
    if key:
      by_user[key].append( row )
      if row.get( "userName" ) and key not in user_name_by_key:
        user_name_by_key[key] = row["userName"]
  output_dir.mkdir( parents=True, exist_ok=True )
  for user_key, user_rows in by_user.items():
    user_rows.sort( key=lambda r: ( r.get( "timestamp", "" ), r.get( "activityType", "" ), r.get( "entityId", "" ) ) )
    display_name = user_name_by_key.get( user_key, user_key )
    suffix = user_rows[0].get( "userId", user_key )
    file_name = f"{safe_filename( display_name )}_{safe_filename( suffix )}.csv"
    file_path = output_dir / file_name
    with file_path.open( "w", newline="", encoding="utf-8" ) as handle:
      fieldnames = [
        "source",
        "activityType",
        "projectId",
        "entityId",
        "entityLabel",
        "userId",
        "userName",
        "email",
        "userKey",
        "timestamp",
        "details",
      ]
      writer = csv.DictWriter( handle, fieldnames=fieldnames )
      writer.writeheader()
      writer.writerows( user_rows )
    logging.info( 'Wrote %s rows to %s', len( user_rows ), file_path )


def main():
  setup_logging()
  logging.info( 'Starting report generation' )
  args = parse_args()
  allowed_emails = load_allowed_emails( args.allowed_emails_file )
  logging.info( 'Loaded %s allowed emails', len( allowed_emails ) )
  short_ids = [ int( value.strip() ) for value in args.projects.split( "," ) if value.strip() ]
  qt4_project_ids = qt4_project_ids_from_short_ids( short_ids )
  legacy_project_ids = legacy_project_ids_from_short_ids( short_ids )
  qt4 = load_live_firestore()
  legacy = load_legacy_rows( legacy_project_ids )
  rows = [ *load_qt4_rows( qt4, qt4_project_ids ), *legacy ]
  rows = [ row for row in rows if not allowed_emails or normalize_email_key( row.get( "email", "" ) ) in allowed_emails ]
  output_dir = Path( args.output_dir )
  write_user_files( rows, output_dir )
  print( f"users={len( { row['userId'] for row in rows if row.get('userId') } )}" )
  print( f"rows={len( rows )}" )
  print( f"output_dir={output_dir}" )


if __name__ == "__main__":
  main()
