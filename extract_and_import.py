#!/usr/bin/env python3
import re
import psycopg2

# The data format from your message
# We'll extract records from the pattern you shared

data_text = """
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
"""

# Database connection
conn = psycopg2.connect(
    host='localhost',
    database='net2app_hub',
    user='net2app_user',
    password='Ariya@2024Net2App'
)
cur = conn.cursor()

# Clear existing
cur.execute("TRUNCATE mccmnc RESTART IDENTITY;")

imported = 0
for line in data_text.strip().split('\n'):
    if line and not line.startswith('country'):
        parts = line.split(',')
        if len(parts) >= 6:
            country = parts[0].strip()
            country_code = parts[1].strip()
            mcc = parts[2].strip()
            mnc = parts[3].strip()
            operator = parts[4].strip()
            network_type = parts[5].strip()
            status = parts[6].strip() if len(parts) > 6 else 'active'
            
            try:
                cur.execute("""
                    INSERT INTO mccmnc (country, country_code, mcc, mnc, operator, network_type, status, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                """, (country, country_code, mcc, mnc, operator, network_type, status.lower()))
                imported += 1
            except Exception as e:
                print(f"Error: {e}")

conn.commit()
cur.close()
conn.close()

print(f"Imported {imported} records")
