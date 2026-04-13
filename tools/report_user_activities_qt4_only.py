#!/usr/bin/env python3
import argparse
import csv
import json
import logging
from collections import defaultdict
from pathlib import Path

from report_user_activities_live import (
  DEFAULT_PROJECTS,
  FirestoreRest,
  GoogleSession,
  json_safe,
  load_allowed_emails,
  normalize_email_key,
  normalized_timestamp,
  one_line_text,
  safe_filename,
)

IMPORTANT_ACTIVITY_TYPES = {
  "document_created",
  "version_created",
  "version_updated",
  "thread_created",
  "comment_created",
  "uploadFile",
  "startReview",
}


def setup_logging():
  logging.basicConfig(
    level=logging.INFO,
    format='[%(levelname)s] %(message)s',
  )


def parse_args():
  parser = argparse.ArgumentParser(
    description="Generate one CSV per user with all QT4 activities, one row per activity.",
  )
  parser.add_argument(
    "--projects",
    default=",".join( str( project ) for project in DEFAULT_PROJECTS ),
    help="Comma-separated project short IDs to include.",
  )
  parser.add_argument(
    "--output-dir",
    default="user_activity_important",
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

  def add_rows(coll_name, activity_type, user_fields, label_field=None, timestamp_fields=None):
    if activity_type not in IMPORTANT_ACTIVITY_TYPES:
      return
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
            "timestamp": normalized_timestamp(
              next(
                ( row.get( field_name ) for field_name in ( timestamp_fields or [ "createdAt", "updatedAt" ] ) if row.get( field_name ) ),
                "",
              )
            ),
            "details": json.dumps( {
              **json_safe( row ),
              **( { label_field: one_line_text( row.get( label_field, "" ) ) } if label_field else {} ),
            }, ensure_ascii=False ),
          } )

  def add_array_rows(coll_name, activity_type, array_field, label_field=None, timestamp_fields=None):
    for doc_id, row in collections.get( coll_name, {} ).items():
      if row.get( "projectId" ) not in project_ids:
        continue
      values = row.get( array_field ) or []
      if not isinstance( values, list ):
        continue
      for uid in values:
        if not uid:
          continue
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
          "timestamp": normalized_timestamp(
            next(
              ( row.get( field_name ) for field_name in ( timestamp_fields or [ "createdAt", "updatedAt" ] ) if row.get( field_name ) ),
              "",
            )
          ),
          "details": json.dumps( {
            **json_safe( row ),
            **( { label_field: one_line_text( row.get( label_field, "" ) ) } if label_field else {} ),
          }, ensure_ascii=False ),
        } )

  add_rows( "documents", "document_created", [ "createdBy" ], "title" )
  add_rows( "versions", "version_created", [ "createdBy" ], "docId" )
  add_rows( "versions", "version_updated", [ "updatedBy" ], "docId" )
  add_rows( "threads", "thread_created", [ "createdBy" ], "docId" )
  add_rows( "comments", "comment_created", [ "createdBy" ], "body" )
  add_rows( "versions", "uploadFile", [ "fileUploadedBy" ], "docId", [ "fileUploadedAt", "createdAt", "updatedAt" ] )
  add_rows( "versions", "startReview", [ "createdBy" ], "docId", [ "reviewStartAt", "createdAt", "updatedAt" ] )
  logging.info( 'QT4 rows generated: %s', len( rows ) )
  return rows


def write_user_files(rows, output_dir, allowed_emails=None, profiles=None):
  logging.info( 'Writing per-user CSV files into %s', output_dir )
  by_user = defaultdict( list )
  user_name_by_key = {}
  user_meta_by_key = {}
  for row in rows:
    key = row.get( "userKey" ) or row.get( "email" ) or row.get( "userId" )
    if key:
      by_user[key].append( row )
      if row.get( "userName" ) and key not in user_name_by_key:
        user_name_by_key[key] = row["userName"]
      if key not in user_meta_by_key:
        user_meta_by_key[key] = {
          "userId": row.get( "userId", "" ),
          "email": row.get( "email", "" ),
        }

  email_to_profile = {}
  if profiles:
    for uid, profile in profiles.items():
      email = normalize_email_key( profile.get( "email", "" ) )
      if email:
        email_to_profile[email] = {
          "userId": uid,
          "userName": profile.get( "displayName" ) or profile.get( "email" ) or uid,
          "email": profile.get( "email" ) or "",
        }

  if allowed_emails:
    for email in sorted( allowed_emails ):
      if email in by_user:
        continue
      profile = email_to_profile.get( email, {} )
      user_key = email
      by_user[user_key] = []
      user_name_by_key[user_key] = profile.get( "userName" ) or email
      user_meta_by_key[user_key] = {
        "userId": profile.get( "userId", email ),
        "email": profile.get( "email", email ),
      }

  output_dir.mkdir( parents=True, exist_ok=True )
  for user_key, user_rows in by_user.items():
    user_rows.sort( key=lambda r: ( r.get( "timestamp", "" ), r.get( "activityType", "" ), r.get( "entityId", "" ) ) )
    display_name = user_name_by_key.get( user_key, user_key )
    suffix = user_meta_by_key.get( user_key, {} ).get( "userId", user_rows[0].get( "userId", user_key ) if user_rows else user_key )
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
  logging.info( 'Starting QT4-only report generation' )
  args = parse_args()
  allowed_emails = load_allowed_emails( args.allowed_emails_file )
  logging.info( 'Loaded %s allowed emails', len( allowed_emails ) )
  short_ids = [ int( value.strip() ) for value in args.projects.split( "," ) if value.strip() ]
  qt4_project_ids = qt4_project_ids_from_short_ids( short_ids )
  qt4 = load_live_firestore()
  rows = load_qt4_rows( qt4, qt4_project_ids )
  rows = [ row for row in rows if not allowed_emails or normalize_email_key( row.get( "email", "" ) ) in allowed_emails ]
  output_dir = Path( args.output_dir )
  write_user_files( rows, output_dir, allowed_emails=allowed_emails, profiles=qt4.get( "userProfiles", {} ) )
  print( f"users={len( { row['userId'] for row in rows if row.get('userId') } )}" )
  print( f"rows={len( rows )}" )
  print( f"output_dir={output_dir}" )


if __name__ == "__main__":
  main()
