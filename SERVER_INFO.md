# NET2APP Hub — Server Reference
# Last updated: July 30, 2026

================================================================================
SERVER 1: 192.95.36.154 (Production — Source of Truth)
================================================================================
URL:      http://192.95.36.154
SSH:      ssh root@192.95.36.154
User:     root
Key:      ~/.ssh/id_rsa (default)
Services: postgresql, net2app-hub (PM2), net2app-smpg, asterisk, nginx
DB:       PostgreSQL — sms_platform / sms_user / Ariya@2024Net2App
Ports:    80 (nginx → frontend), 3001 (Node API), 2775 (SMPP), 5038 (Asterisk AMI)
Login:    admin / admin123

================================================================================
SERVER 2: 51.178.20.165 (Staging/Test)
================================================================================
URL:      http://51.178.20.165
SSH:      ssh root@51.178.20.165
User:     root
Key:      ~/.ssh/id_rsa (default)
Services: postgresql, net2app-hub (systemd), net2app-smpg (systemd), asterisk, nginx
DB:       PostgreSQL — sms_platform / sms_user / Ariya@2024Net2App
Ports:    80 (nginx), 3001 (Node API), 2775 (SMPP), 5038 (AMI)
Login:    admin / admin123

================================================================================
SERVER 3: 147.135.128.43 (A2Z / New Production)
================================================================================
URL:      http://147.135.128.43
SSH:      sshpass -p 'Telco1988' ssh ubuntu@147.135.128.43
User:     ubuntu / Telco1988 | su pass: Telco1988
OS:       Ubuntu 24.04.4 LTS
RAM:      31 GB
Disk:     108 GB (18 GB used)
Services: net2app-hub (systemd), net2app-smpg (systemd), asterisk, postgresql, nginx
DB:       PostgreSQL — sms_platform / sms_user / Ariya@2024Net2App
Ports:    80 (nginx), 3001 (Node API), 2775 (SMPP), 5038 (AMI), 8081 (Java debug)
Firewall: ufw — 22, 80, 443, 2775, 3000, 3001, 5038, 7070, 7171 (all open)
Login:    admin / admin123
Code:     /home/ubuntu/net2app-v3

Installed:
  Node.js:    v22.23.1
  PostgreSQL: 16.14
  Nginx:      1.24.0
  Asterisk:   20.6.0
  Java:       OpenJDK 21.0.11
  Maven:      3.8.7
  npm:        installed at /home/ubuntu/net2app-v3/node_modules

================================================================================
LOCAL DEV (this machine — /home/ubuntu/net2app-v3)
================================================================================
Path:  /home/ubuntu/net2app-v3
DB:    PostgreSQL — sms_platform / sms_user / Ariya@2024Net2App
Ports: 3001 (API), 5173 (Vite dev)
Login: admin / admin123

================================================================================
BILLING SYSTEM (deployed on all servers)
================================================================================

Three billing modes per client AND supplier (independently configured):

| Mode               | When charged              | Behavior                              |
|--------------------|--------------------------|---------------------------------------|
| On Submit          | Immediately at SMS send  | Balance deducted before queuing       |
| On DLR             | Only on DELIVRD          | Balance deducted when DLR arrives     |
| Force DLR          | Immediately at send + auto-DLR | Charge instantly + fake DELIVRD after N seconds |

4 billing combinations per message:
  Client submit + Supplier submit → both charged immediately
  Client submit + Supplier dlr    → client now, supplier on DLR
  Client dlr    + Supplier submit → supplier now, client on DLR
  Client dlr    + Supplier dlr    → both on DLR success

force_dlr_timeout:
  • Column: force_dlr_timeout INTEGER DEFAULT 0 (seconds)
  • 0 = instant fake DELIVRD
  • 1 = DELIVRD appears after 1 second
  • Charges immediately regardless of billing_mode
  • Sets is_force_dlr=true on sms_logs
  • Won't overwrite real DLR (guarded by dlr_status='PENDING')

Implementation:
  • applyBilling() — atomic claim-first pattern prevents double-billing
  • is_client_billed / is_supplier_billed — per-party flags on sms_logs
  • is_billed — composite flag (both parties done)
  • Retroactive biller runs every 10s, catches missed DLRs
  • smppClient.mjs does inline DLR billing on deliver_sm DELIVRD

DB columns added:
  suppliers.billing_mode VARCHAR(20) DEFAULT 'dlr'
  clients.force_dlr_timeout INTEGER DEFAULT 0
  suppliers.force_dlr_timeout INTEGER DEFAULT 0
  sms_logs.is_client_billed BOOLEAN DEFAULT false
  sms_logs.is_supplier_billed BOOLEAN DEFAULT false
  sms_logs.supplier_billing_mode_snapshot VARCHAR(20)
  sms_outbox.supplier_billing_mode VARCHAR(20) DEFAULT 'dlr'
  rates.previous_rate DECIMAL(10,6)
  rates.updated_at TIMESTAMP

================================================================================
QUICK COMMANDS
================================================================================

# Deploy to new server (one-shot)
./deploy_to_newserver.sh <NEW_SERVER_IP>
./deploy_to_newserver.sh 147.135.128.43 ubuntu ~/.ssh/mykey

# Deploy code updates to existing servers (quick)
cd /home/ubuntu/net2app-v3
npm run build

# → 51.178.20.165
scp server.cjs src/services/smsQueueManager.mjs src/services/smppClient.mjs root@51.178.20.165:/tmp/
ssh root@51.178.20.165 'cp /tmp/server.cjs /home/ubuntu/net2app-v3/ && cp /tmp/smsQueueManager.mjs /home/ubuntu/net2app-v3/src/services/ && cp /tmp/smppClient.mjs /home/ubuntu/net2app-v3/src/services/ && systemctl restart net2app-hub'

# → 147.135.128.43
sshpass -p 'Telco1988' scp server.cjs src/services/smsQueueManager.mjs src/services/smppClient.mjs ubuntu@147.135.128.43:/tmp/
sshpass -p 'Telco1988' ssh ubuntu@147.135.128.43 'sudo cp /tmp/server.cjs /home/ubuntu/net2app-v3/ && sudo cp /tmp/smsQueueManager.mjs /home/ubuntu/net2app-v3/src/services/ && sudo cp /tmp/smppClient.mjs /home/ubuntu/net2app-v3/src/services/ && sudo systemctl restart net2app-hub'

# View logs
ssh root@51.178.20.165 'journalctl -u net2app-hub -f'
sshpass -p 'Telco1988' ssh ubuntu@147.135.128.43 'sudo journalctl -u net2app-hub -f'

# Check billing on a message
sudo -u postgres psql -d sms_platform -c "SELECT message_id, billing_mode_snapshot, supplier_billing_mode_snapshot, is_client_billed, is_supplier_billed, is_billed, is_force_dlr FROM sms_logs WHERE message_id='MSG...'"

# Set force_dlr on a client
sudo -u postgres psql -d sms_platform -c "UPDATE clients SET force_dlr=true, force_dlr_timeout=1 WHERE client_code='ClientXYZ'"

# Set supplier billing_mode
sudo -u postgres psql -d sms_platform -c "UPDATE suppliers SET billing_mode='submit' WHERE supplier_code='TriAngle'"

================================================================================
KEY FILES
================================================================================

server.cjs                          — Main API server (339KB, Express + 50 PG pool)
src/services/smsQueueManager.mjs    — Async job queue with FOR UPDATE SKIP LOCKED
src/services/smppClient.mjs         — SMPP client with DLR billing
src/services/connectionPipeline.mjs — SMPP connection pool manager
src/services/voiceOtpEngine.cjs     — Voice OTP call engine
src/services/translationEngine.cjs  — Number/content translation rules
asterisk-bridge.cjs                 — Asterisk AMI + direct UDP SIP bridge
java-sms-gateway/                   — Java 21 SMPP gateway (port 2775)
src/database/schema.sql             — Full database schema (60KB)
src/database/migrate_v2.sql         — Migration v2
deploy_to_newserver.sh              — One-shot new server deployment script
SERVER_INFO.md                      — This file
