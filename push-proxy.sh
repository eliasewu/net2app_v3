#!/bin/bash
# ============================================================
# push-proxy.sh — Push residential SOCKS5 proxy to NET2APP Hub
# ============================================================
# Run this on your home PC to register your local SOCKS5 proxy
# with the NET2APP Hub server so WhatsApp/Telegram API suppliers
# can use your home IP as a residential proxy.
#
# Usage:
#   ./push-proxy.sh [server_url] [secret]
#
# Defaults:
#   SERVER_URL=http://localhost:3000
#   SECRET=net2app-proxy-2024
#
# Environment:
#   PROXY_HOST  — override auto-detected public IP (default: auto-detect)
#   PROXY_PORT  — proxy port (default: 1080)
#   PROXY_USER  — proxy username (default: empty)
#   PROXY_PASS  — proxy password (default: empty)
#   PROXY_TYPE  — proxy type (default: socks5)
# ============================================================

SERVER_URL="${1:-http://localhost:3000}"
SECRET="${2:-net2app-proxy-2024}"

PROXY_HOST="${PROXY_HOST:-}"
PROXY_PORT="${PROXY_PORT:-1080}"
PROXY_USER="${PROXY_USER:-}"
PROXY_PASS="${PROXY_PASS:-}"
PROXY_TYPE="${PROXY_TYPE:-socks5}"
NAME="${NAME:-Home Residential Proxy}"

# Auto-detect public IP if not provided
if [ -z "$PROXY_HOST" ]; then
  echo "[push-proxy] Auto-detecting public IP..."
  PROXY_HOST=$(curl -s https://api.ipify.org 2>/dev/null || curl -s https://ifconfig.me 2>/dev/null || curl -s https://icanhazip.com 2>/dev/null || echo "")
  if [ -z "$PROXY_HOST" ]; then
    echo "[push-proxy] ERROR: Could not detect public IP. Set PROXY_HOST= manually."
    exit 1
  fi
fi

echo "========================================"
echo "  WhatsApp + Telegram Proxy Tool"
echo "  Dynamic Residential IP"
echo "========================================"
echo "Current Public IP: $PROXY_HOST"
echo "Date: $(date '+%d/%m/%Y')"
echo "Time:  $(date '+%H:%M:%S')"
echo ""
echo "✅ IP automatically saved to current_ip.txt and ip_history.txt"
echo "Registering SOCKS5 proxy $PROXY_HOST:$PROXY_PORT with NET2APP Hub..."
echo "Keep this window open (runs heartbeat every 60s)..."

# Save IP to local files for tracking
echo "$PROXY_HOST" > current_ip.txt
echo "$(date '+%Y-%m-%d %H:%M:%S') $PROXY_HOST" >> ip_history.txt

# Push proxy registration to server
echo ""
echo -n "[push-proxy] Registering $PROXY_HOST:$PROXY_PORT with server... "

RESP=$(curl -s -X POST "$SERVER_URL/api/proxy/register" \
  -H "Content-Type: application/json" \
  -H "x-proxy-secret: $SECRET" \
  -d "{
    \"name\": \"$NAME\",
    \"host\": \"$PROXY_HOST\",
    \"port\": $PROXY_PORT,
    \"username\": \"$PROXY_USER\",
    \"password\": \"$PROXY_PASS\",
    \"proxy_type\": \"$PROXY_TYPE\"
  }" 2>&1)

if echo "$RESP" | grep -q '"success":true'; then
  echo "✅ Registered!"
  echo "$RESP" | grep -o '"message":"[^"]*"'
else
  echo "❌ Failed!"
  echo "Server response: $RESP"
fi

# Heartbeat loop — keep proxy marked online every 60 seconds
echo ""
echo "[push-proxy] Starting heartbeat loop (every 60s)..."
echo "[push-proxy] Press Ctrl+C to stop."

while true; do
  sleep 60
  
  HB_RESP=$(curl -s -X POST "$SERVER_URL/api/proxy/heartbeat" \
    -H "Content-Type: application/json" \
    -H "x-proxy-secret: $SECRET" \
    -d "{
      \"host\": \"$PROXY_HOST\",
      \"port\": $PROXY_PORT
    }" 2>/dev/null)
  
  if echo "$HB_RESP" | grep -q '"success":true'; then
    echo "[push-proxy] $(date '+%H:%M:%S') 💚 Heartbeat OK — $PROXY_HOST:$PROXY_PORT"
  else
    echo "[push-proxy] $(date '+%H:%M:%S') ❤️‍🔥 Heartbeat FAILED"
  fi
done
