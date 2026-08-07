# NET2APP Android SMS Gateway

Turns any Android phone into an SMS supplier for NET2APP Hub.

## Quick Start

### 1. Server Setup
```bash
# Add android_SMS connection type to the database
psql -U sms_user -d sms_platform -f migrate-add-android-sms.sql

# Add gateway API routes to server.cjs
cd android-gateway
bash install-server-gateway.sh

# Restart server
pm2 restart server
```

### 2. Build APK
```bash
cd android-gateway
npm install
npm run build
npx cap add android
npx cap sync
cd android && ./gradlew assembleDebug
# APK at: app/build/outputs/apk/debug/app-debug.apk
```

### 3. Install on Android
1. Transfer APK to phone
2. Install (accept "Unknown sources" prompt)
3. Open app → grant SMS permissions
4. Enter server URL, username, password
5. Tap "Save & Connect"

## Connection Types

| Type | Status | Description |
|------|--------|-------------|
| **HTTP REST API** | ✅ Fully implemented | Recommended for most setups. Polls `/api/gateway/heartbeat` every 5s for MT messages. Forwards MO SMS via HTTP. Reliable on mobile networks. |
| **SMPP (Port 2775)** | ✅ Fully implemented | Direct SMPP ESME client connection using **jsmpp** library. Binds as transceiver (TRX) to server's SMPP port. MT SMS via `deliver_sm`, MO SMS via `submit_sm`. SMPP v3.4 with auto-reconnect. Requires stable IP and open port 2775. |

### How SMPP Mode Works

```
Android Phone (ESME)                     NET2APP Server (SMSC)
─────────────────────                    ──────────────────────
     │ bind_transceiver ───────────────►│
     │◄── bind_transceiver_resp ───────│  ✅ Bound (TRX)
     │                                   │
     │◄── deliver_sm (MT SMS) ─────────│  Server wants us to deliver
     │──── deliver_sm_resp ────────────►│  SMS via phone's SIM
     │                                   │
     │──── submit_sm (MO SMS) ─────────►│  Forward incoming SMS
     │◄── submit_sm_resp ──────────────│  to server
     │                                   │
     │──── enquire_link ───────────────►│  Every 15 seconds
     │◄── enquire_link_resp ───────────│  Keepalive
```

- **MT Delivery**: Server sends `deliver_sm` → phone sends SMS via `SmsManager`
- **MO Forwarding**: Phone receives SMS → forwarded via `submit_sm` to server
- **DLR Handling**: Delivery receipts parsed from `deliver_sm` with `esm_class=0x04`
- **Reconnect**: Exponential backoff (5s → 60s, up to 100 attempts)
- **Fallback**: MO SMS buffer + HTTP polling runs alongside SMPP for resilience

## How It Works

### HTTP REST Mode
```
Android Phone                          NET2APP Server
├── HTTP POST /api/gateway/heartbeat ─► every 5 seconds
│   ◄── response with pending_mt[] ──│
├── SmsManager.sendTextMessage() ─────► Cellular Network
├── BroadcastReceiver ◄─────────────── Incoming SMS
├── HTTP POST /api/gateway/mo-sms ────► Forward MO to server
└── HTTP POST /api/gateway/mt-dlr ────► Report delivery status
```

### SMPP Mode
```
Android Phone (ESME)                  NET2APP Server (SMSC)
├── bind_transceiver ─────────────────► Port 2775
├── ◄── deliver_sm (MT SMS) ─────────│ Server delivers MT
├── ──── deliver_sm_resp ────────────►│
├── ──── submit_sm (MO SMS) ─────────►│ Phone forwards MO
├── ◄── submit_sm_resp ───────────────│
├── ──── enquire_link ───────────────►│ Every 15s keepalive
└── Auto-reconnect with backoff       │
```

## Permissions Required
- `SEND_SMS` — to send MT messages
- `RECEIVE_SMS` — to capture MO messages  
- `READ_SMS` — to read inbox
- `FOREGROUND_SERVICE` — for persistent background operation
- `POST_NOTIFICATIONS` — for Android 13+ notification
- `INTERNET` — to connect to server

## Project Structure
```
android-gateway/
├── src/                     # React frontend (Capacitor web layer)
│   ├── App.tsx             # Main app with routing
│   ├── pages/
│   │   ├── SetupPage.tsx   # Server connection config
│   │   ├── DashboardPage.tsx # Status + quick send
│   │   ├── InboxPage.tsx   # Received SMS
│   │   └── OutboxPage.tsx  # Sent SMS
│   ├── services/
│   │   ├── GatewayContext.tsx  # State management
│   │   └── ApiClient.ts       # HTTP REST client
│   └── background.js       # Capacitor background runner
├── android/                # Native Android layer
│   ├── app/build.gradle   # Gradle config + jsmpp dependency
│   ├── app/proguard-rules.pro
│   └── app/src/main/java/com/net2app/gateway/
│       ├── SmsGatewayPlugin.java        # Capacitor plugin (SMS, SMPP, HTTP)
│       ├── SmppGatewayClient.java       # Full SMPP ESME client (jsmpp)
│       ├── GatewaySmsReceiver.java      # Manifest SMS receiver
│       ├── GatewayForegroundService.java # Persistent foreground service
│       ├── BootReceiver.java            # Auto-start on boot
│       └── MainActivity.java            # Capacitor entry point
├── server-gateway-routes.cjs  # Server-side API routes (add to server.cjs)
├── migrate-add-android-sms.sql  # DB migration
└── BUILD.md                  # Full build instructions
```
