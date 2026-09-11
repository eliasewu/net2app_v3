# NET2APP Hub - HTTPS Deployment with Certbot (Let's Encrypt)

## Prerequisites
- Ubuntu/Debian server with root/sudo access
- Domain name pointing to your server (e.g., `sms.net2app.com`)
- Nginx or Apache web server installed
- Port 80 and 443 open in firewall

## 1. Install Certbot

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install certbot and nginx plugin
sudo apt install -y certbot python3-certbot-nginx

# OR for Apache
sudo apt install -y certbot python3-certbot-apache
```

## 2. Configure Nginx (Recommended)

```bash
# Create Nginx config
sudo nano /etc/nginx/sites-available/net2app-hub
```

```nginx
server {
    listen 80;
    server_name sms.net2app.com;  # YOUR DOMAIN

    root /var/www/net2app-hub/dist;
    index index.html;

    # Single file SPA - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API reverse proxy (if backend on same server)
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip compression
    gzip on;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1000;
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/net2app-hub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 3. Deploy Frontend Build

```bash
# Create app directory
sudo mkdir -p /var/www/net2app-hub

# Copy build files (from your local machine)
scp -r dist/* user@your-server:/var/www/net2app-hub/dist/

# Set permissions
sudo chown -R www-data:www-data /var/www/net2app-hub
sudo chmod -R 755 /var/www/net2app-hub
```

## 4. Get SSL Certificate with Certbot

```bash
# Run certbot - automatic HTTPS
sudo certbot --nginx -d sms.net2app.com

# Follow the prompts:
# - Enter email for renewal notices
# - Agree to terms of service
# - Choose redirect (redirect HTTP to HTTPS)

# Test auto-renewal
sudo certbot renew --dry-run
```

## 5. Automatic Certificate Renewal

```bash
# Certbot adds a systemd timer automatically
# Verify it's running:
sudo systemctl status certbot.timer

# Manual renewal if needed:
sudo certbot renew
```

## 6. Firewall Settings

```bash
# Allow HTTPS
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp
sudo ufw reload
```

## 7. Verify HTTPS

```bash
# Test SSL
curl -I https://sms.net2app.com

# Should see:
# HTTP/2 200
# strict-transport-security: max-age=...
```

## 8. PostgreSQL Setup (if not already)

```bash
# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql

CREATE DATABASE net2app_hub;
CREATE USER net2app_user WITH PASSWORD 'YourStrongPassword!';
GRANT ALL PRIVILEGES ON DATABASE net2app_hub TO net2app_user;
\q

# Import schema
sudo -u postgres psql -d net2app_hub -f src/database/schema.sql
```

## 9. Full Production Checklist

- [ ] Domain DNS points to server IP
- [ ] Nginx configured and running
- [ ] SSL certificate installed via certbot
- [ ] HTTP redirects to HTTPS
- [ ] PostgreSQL running with schema imported
- [ ] Backend API running on port 3001
- [ ] Firewall allows ports 80, 443, 3001 (internal)
- [ ] Environment variables set (.env)
- [ ] Auto-renewal cron/certbot timer active
- [ ] Backup strategy in place

## Common Commands

```bash
# Check certbot certificates
sudo certbot certificates

# Force renewal
sudo certbot renew --force-renewal

# Check nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Restart services
sudo systemctl restart nginx
sudo systemctl restart postgresql
```
