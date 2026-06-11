#!/usr/bin/env python3
import csv
import psycopg2
import re

# Database connection
conn = psycopg2.connect(
    host='localhost',
    database='net2app_hub',
    user='net2app_user',
    password='Ariya@2024Net2App'
)
cur = conn.cursor()

# Since we have the data in a text file, let's read it from the CSV you shared
# But first, let's check if we have a file

import os

# Look for the CSV file
csv_files = [
    '/tmp/mccmnc_export.csv',
    '/home/ubuntu/net2app-hub/MCCMNC.csv',
    '/tmp/mccmnc_complete.csv'
]

csv_file = None
for f in csv_files:
    if os.path.exists(f):
        csv_file = f
        print(f"Found CSV file: {csv_file}")
        break

if not csv_file:
    print("No CSV file found. Please upload the MCCMNC.csv file to /tmp/")
    print("You can use: scp MCCMNC.csv root@146.59.47.22:/tmp/")
    exit(1)

# Read and import
imported = 0
skipped = 0
errors = 0

with open(csv_file, 'r', encoding='utf-8') as f:
    # Skip BOM if present
    content = f.read()
    if content.startswith('\ufeff'):
        content = content[1:]
    
    reader = csv.DictReader(content.splitlines())
    
    for row in reader:
        try:
            # Clean up data
            country = row.get('country', '').strip()
            country_code = row.get('country_code', '').strip().upper()
            mcc = row.get('mcc', '').strip()
            mnc = row.get('mnc', '').strip()
            operator = row.get('operator', '').strip()
            network_type = row.get('network_type', 'GSM').strip()
            status = row.get('status', 'active').strip().lower()
            
            # Skip if missing required fields
            if not country or not mcc or not operator:
                skipped += 1
                continue
            
            # Handle wildcard mnc
            if not mnc or mnc == '*':
                mnc = '0'
            
            # Check if exists
            cur.execute("SELECT id FROM mccmnc WHERE mcc = %s AND mnc = %s", (mcc, mnc))
            
            if cur.fetchone():
                skipped += 1
                continue
            
            # Insert
            cur.execute("""
                INSERT INTO mccmnc (country, country_code, mcc, mnc, operator, network_type, status, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
            """, (country, country_code, mcc, mnc, operator, network_type, status))
            
            imported += 1
            
            if imported % 100 == 0:
                print(f"Imported {imported} records...")
                conn.commit()
                
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"Error: {e} for row: {row}")

conn.commit()
cur.close()
conn.close()

print(f"\n{'='*50}")
print(f"IMPORT COMPLETE!")
print(f"{'='*50}")
print(f"✅ Imported: {imported}")
print(f"⏭️  Skipped (duplicates): {skipped}")
print(f"❌ Errors: {errors}")
print(f"{'='*50}")
