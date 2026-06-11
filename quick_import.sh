#!/bin/bash

# Check if CSV file exists
if [ ! -f "/tmp/MCCMNC.csv" ]; then
    echo "Please upload MCCMNC.csv to /tmp/"
    echo "Run this from your local machine:"
    echo "scp /path/to/MCCMNC.csv root@146.59.47.22:/tmp/"
    exit 1
fi

echo "Importing MCCMNC data..."

# Import using PostgreSQL COPY
sudo -u postgres psql -d net2app_hub << SQLEOF
-- Clear existing data
TRUNCATE mccmnc RESTART IDENTITY;

-- Import from CSV
COPY mccmnc(country, country_code, mcc, mnc, operator, network_type, status, created_at)
FROM '/tmp/MCCMNC.csv' 
DELIMITER ',' 
CSV HEADER;

-- Show results
SELECT COUNT(*) as total_records FROM mccmnc;
SELECT COUNT(DISTINCT country) as total_countries FROM mccmnc;
SELECT COUNT(DISTINCT mcc) as total_mccs FROM mccmnc;
SQLEOF

echo ""
echo "✅ Import complete!"
echo "Check the statistics above"
