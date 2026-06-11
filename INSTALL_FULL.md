# NET2APP Hub - Complete Production Deployment Guide
# Ubuntu 22.04 / Debian 12

## System Architecture
```
Browser → Nginx (443) → Node.js (3001) → PostgreSQL (5432)
                                          → Asterisk SIP (5060)
                                          → SMPP ESME (2775)
```

## 1. Quick Install
```bash
# Clone and run installer
git clone https://github.com/eliasewu/net2app-hub.git /opt/net2app-hub
cd /opt/net2app-hub
sudo bash install.sh sms.yourdomain.com
```

## 2. PostgreSQL Setup
```bash
sudo -u postgres psql
CREATE DATABASE net2app_hub;
\c net2app_hub
\i src/database/schema.sql
\q

# Verify
sudo -u postgres psql -d net2app_hub -c "\dt"
# Should show 27 tables
```

## 3. Asterisk SIP Installation
```bash
# Install Asterisk 20
sudo apt install -y asterisk asterisk-dahdi

# Configure SIP
sudo nano /etc/asterisk/sip.conf
```
```ini
[general]
context=default
bindport=5060
bindaddr=0.0.0.0
allowguest=no

[net2app](!)
type=friend
context=voice-otp
host=dynamic
nat=force_rport,comedia
qualify=yes
disallow=all
allow=ulaw
allow=alaw

[trunk1](net2app)
secret=trunk1pass
callerid="+18001234567"
```

```bash
sudo systemctl restart asterisk
sudo asterisk -rx "sip show peers"
```

## 4. Node.js Backend (server.cjs)
```bash
cd /opt/net2app-hub
npm install pg bcryptjs jsonwebtoken cors dotenv

# Create .env
cat > .env << EOF
DB_HOST=localhost
DB_PORT=5432
DB_NAME=net2app_hub
DB_USER=postgres
DB_PASS=your_password
PORT=3001
JWT_SECRET=$(openssl rand -hex 32)
EOF

# Start
node server.cjs
# Listening on port 3001
```

## 5. Nginx Reverse Proxy
```bash
sudo nano /etc/nginx/sites-available/net2app-hub
```
```nginx
server {
    listen 443 ssl;
    server_name sms.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/sms.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sms.yourdomain.com/privkey.pem;

    root /opt/net2app-hub/dist;
    index index.html;

    location / { try_files $uri $uri/ /index.html; }
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 6. SMS Flow (Complete)
```
1. Client SMPP Bind → ESME Server (0.0.0.0:2775)
   ├── auth: smpp_username + smpp_password
   ├── IP whitelist check (smpp_ip field)
   └── TPS throttling (max_tps field)

2. Client submits SMS → POST /api/sms/send
   ├── Validate client (active + credentials)
   ├── Check route plan (mandatory)
   ├── MCCMNC lookup (mccmnc table)
   ├── Route Map match (mccmnc_pattern LIKE '310%')
   ├── Rate Check: profit = client_rate - supplier_rate
   │   ├── profit ≤ 0 → ROUTE BLOCKED → find alternative
   │   └── profit > 0 → ALLOW
   ├── Balance Check: balance + credit_limit ≥ cost
   ├── INSERT INTO sms_logs (status='submitted')
   ├── Submit to Supplier SMPP Client (5.78.72.23:2775)
   └── DLR Processing:
       ├── DELIVRD → status='delivered', charge if billing_mode='dlr'
       └── UNDELIV → status='failed', NO charge

3. DLR Queue Processing:
   ├── Every 30s retry for DLR
   ├── Max timeout 150s
   ├── force_dlr=true → mark delivered anyway after timeout
   └── 20 consecutive failures → auto-block supplier

4. Billing:
   ├── submit mode: charge on submission
   ├── dlr mode: charge only on DELIVRD
   └── Invoice: SUM sms_logs → subtotal + 19% tax = grand total

5. All SMS saved to sms_logs table → visible in SMS Logs page
   ├── Testing SMS → client_id=null, saved to DB
   ├── Client SMS → client_id set, shows in client CDR
   └── Real-time dashboard updates
```

## 7. Voice OTP Flow
```
1. Destination dialed → Detect country prefix (mccmnc lookup)
2. Route to Asterisk SIP via configured provider
3. Play language greeting + OTP digits (0-9 audio files)
4. Connected → status=completed, DLR=DELIVRD
5. Busy/No answer → retry up to N times every Ms
6. Final fail → status=failed, no DLR forwarded
```

## 8. Asterisk AGI Script (voice-otp.php)
```php
#!/usr/bin/php
<?php
// /var/lib/asterisk/agi-bin/voice-otp.php
require '/opt/net2app-hub/agi-config.php';

$agi = new AGI();
$caller = $agi->request['agi_callerid'];
$destination = $agi->request['agi_extension'];

// Query DB for language config
$db = new PDO("pgsql:host=localhost;dbname=net2app_hub", "postgres", "password");
$stmt = $db->prepare("SELECT * FROM voice_otp_configs WHERE country_prefix = ? AND is_active = true LIMIT 1");
$stmt->execute([substr($destination, 0, 3)]);
$config = $stmt->fetch();

if ($config) {
    // Play greeting
    $agi->exec('Playback', $config['greeting_file'] ?: 'custom/' . $config['language_code'] . '-greeting');
    // Play OTP digits
    $otp = '123456'; // Generated OTP
    foreach (str_split($otp) as $digit) {
        $agi->exec('Playback', 'digits/' . $config['language_code'] . '/' . $digit);
    }
}
$agi->exec('Hangup');
```

## 9. Database Tables (27 total)
```
users, clients, suppliers, trunks, routes, route_plans, route_maps,
rates, mccmnc, sms_logs, dlr_queue, invoices, payments,
ott_devices, api_connectors, voice_otp_configs, voice_otp_logs,
campaigns, campaigns_recipients, translations,
notifications, notification_templates, license, tenants,
platform_settings, smtp_config, audit_logs
```

## 10. API Endpoints
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| /api/auth/login | POST | None | JWT login |
| /api/clients | GET/POST/PUT/DELETE | JWT | Client CRUD |
| /api/suppliers | GET/POST/PUT/DELETE | JWT | Supplier CRUD |
| /api/sms/send | POST | JWT | Send SMS |
| /api/sms/logs | POST | JWT | Query SMS logs |
| /api/rates | GET/POST/PUT/DELETE | JWT | Rate CRUD |
| /api/billing/invoices | GET/POST | JWT | Invoice CRUD |
| /api/bind/status | GET | JWT | Bind status |
| /api/v1/sms/send | POST | username+password | External API |
| /api/v1/sms/dlr/:id | GET | username+password | DLR inquiry |
| /api/v1/account/balance | GET | username+password | Balance check |

## 11. Multi-SIP Provider Setup
```sql
-- Add SIP providers to voice_otp_configs
INSERT INTO voice_otp_configs (language,language_code,country_prefix,sip_host,sip_port) VALUES
('Arabic','ar-SA','966','sip.provider1.com',5060),
('English','en-US','1','sip.provider1.com',5060),
('Bangla','bn-BD','880','sip.provider2.com',5060);
```

## 12. Production Checklist
- [ ] PostgreSQL running with schema imported
- [ ] Asterisk SIP configured with trunk
- [ ] Node.js server running on port 3001
- [ ] Nginx reverse proxy with SSL
- [ ] Firewall: ports 80,443,3001,2775,5060 open
- [ ] Certbot SSL auto-renewal active
- [ ] Systemd service: net2app-hub running
- [ ] Backup cron job configured
- [ ] Monitoring: journalctl -u net2app-hub -f
