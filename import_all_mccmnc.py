#!/usr/bin/env python3
import csv
import psycopg2
import sys
from io import StringIO

# Your full CSV data as a string (paste the complete data)
csv_data = """country,country_code,mcc,mnc,operator,network_type,status
Georgia,Ge,282,3,Iberiatel Ltd.,LTE,Active
Georgia,Ge,282,6,JSC Compatel,LTE,Active
Georgia,Ge,282,2,Magti GSM Ltd.,LTE,Active
Georgia,Ge,282,4,MobiTel/Beeline,LTE,Active
Georgia,Ge,282,5,Silknet,LTE,Active
Georgia,Ge,282,8,Silknet,LTE,Active
Turkey,Tu,286,286,Turkey all operators,LTE,Active
Turkey,Tu,286,3,Avea,LTE,Active
Turkey,Tu,286,4,Avea,LTE,Active
Turkey,Tu,286,1,Turkcell,LTE,Active
Turkey,Tu,286,2,Vodafone,LTE,Active
Turkey,Tu,286,999,Fix Line,LTE,Active
Albania,Al,276,276,Albania all operators,LTE,Active
Albania,Al,276,3,ALBtelecom Mobile / Eagle,LTE,Active
Albania,Al,276,1,One / AMC,LTE,Active
Albania,Al,276,4,PLUS Communication Sh.a,LTE,Active
Albania,Al,276,2,Vodafone,LTE,Active
Iceland,Ic,274,274,Iceland all operators,LTE,Active
Iceland,Ic,274,9,Amitelo,LTE,Active
Iceland,Ic,274,7,IceCell,LTE,Active
Iceland,Ic,274,4,IMC Island ehf.,LTE,Active
Iceland,Ic,274,6,Nuii Niu Ehf,LTE,Active
Iceland,Ic,274,1,Siminn hf.,LTE,Active
Iceland,Ic,274,8,Siminn hf.,LTE,Active
Iceland,Ic,274,2,Syn hf. / Vodafone,LTE,Active
Iceland,Ic,274,3,Syn hf. / Vodafone,LTE,Active
Iceland,Ic,274,5,Syn hf. / Vodafone,LTE,Active
Iceland,Ic,274,11,NOVA,LTE,Active
Iceland,Ic,274,12,Syn hf. / Vodafone,LTE,Active
Iceland,Ic,274,16,Tismi BV,LTE,Active
Iceland,Ic,274,31,Siminn hf.,LTE,Active
Ireland,Ir,272,272,Ireland all operators,LTE,Active
Ireland,Ir,272,4,Access Telecom Ltd.,LTE,Active
Ireland,Ir,272,9,Clever Communications Ltd,LTE,Active
Ireland,Ir,272,3,Meteor,LTE,Active
Abkhazia,Ab,289,289,Abkhazia all operators,LTE,Active
Ireland,Ir,272,7,Meteor,LTE,Active
Ireland,Ir,272,8,Meteor,LTE,Active
Ireland,Ir,272,2,Three,LTE,Active
Ireland,Ir,272,5,Three,LTE,Active
Ireland,Ir,272,1,Vodafone,LTE,Active
Ireland,Ir,272,13,Lycamobile,LTE,Active
Ireland,Ir,272,11,Tesco Mobile,LTE,Active
Ireland,Ir,272,17,Three,LTE,Active
Ireland,Ir,272,15,Virgin Media,LTE,Active"""

# Database connection
conn = psycopg2.connect(
    host='localhost',
    database='net2app_hub',
    user='net2app_user',
    password='Ariya@2024Net2App'
)
cur = conn.cursor()

# Read CSV from string
csv_reader = csv.DictReader(StringIO(csv_data))

imported = 0
skipped = 0

for row in csv_reader:
    try:
        # Check if exists
        cur.execute("SELECT id FROM mccmnc WHERE mcc = %s AND mnc = %s", 
                   (row['mcc'], row['mnc']))
        
        if cur.fetchone():
            skipped += 1
            continue
        
        # Insert new record
        cur.execute("""
            INSERT INTO mccmnc (country, country_code, mcc, mnc, operator, network_type, status, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        """, (row['country'], row['country_code'], row['mcc'], row['mnc'], 
              row['operator'], row['network_type'], row['status'].lower()))
        
        imported += 1
        
        if imported % 100 == 0:
            print(f"Imported {imported} records...")
            conn.commit()
            
    except Exception as e:
        print(f"Error importing {row['operator']}: {e}")

conn.commit()
cur.close()
conn.close()

print(f"\n✅ Import complete!")
print(f"   Imported: {imported}")
print(f"   Skipped (duplicates): {skipped}")

# Show final count
conn = psycopg2.connect(
    host='localhost',
    database='net2app_hub',
    user='net2app_user',
    password='Ariya@2024Net2App'
)
cur = conn.cursor()
cur.execute("SELECT COUNT(*) FROM mccmnc")
total = cur.fetchone()[0]
print(f"   Total records in database: {total}")
cur.close()
conn.close()
