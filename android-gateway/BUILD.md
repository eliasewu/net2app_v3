# NET2APP Android Gateway — Build Guide

## Overview
The Android SMS Gateway turns any Android phone into an SMS supplier for NET2APP Hub. It connects to your server via HTTP REST API and uses the phone's SIM card to send and receive SMS.

## Architecture
```
┌─────────────────┐         HTTP REST API          ┌──────────────────┐
│  Android Phone  │ ◄──── heartbeat /5s ────────► │  NET2APP Server  │
│  (this app)     │ ◄──── pending MT SMS ──────── │  (port 3001)     │
│                 │ ───── MO SMS forward ────────► │                  │
│  ┌───────────┐  │ ───── MT DLR report ────────► │  ┌────────────┐  │
│  │ Capacitor │  │                                │  │ sms_outbox  │  │
│  │ + React   │  │                                │  │ sms_logs    │  │
│  │ + Plugin  │  │                                │  └────────────┘  │
│  └───────────┘  │                                └──────────────────┘
│  ┌───────────┐  │
│  │ SmsManager │◄──────── sends MT SMS ─────────►  Mobile Network
│  │ SMSReceiver│─────── receives MO SMS ────────►  (GSM/4G/5G)
│  └───────────┘  │
└─────────────────┘
```

## Prerequisites

### On your build machine (Linux/Ubuntu):
```bash
# 1. Node.js 18+
node -v  # Should be v18+

# 2. Java JDK 17+
sudo apt install openjdk-17-jdk
java -version

# 3. Android SDK (install via commandline or Android Studio)
# Option A: Install Android Studio (recommended)
# Option B: Install command-line tools only
sudo apt install android-sdk

# 4. Set ANDROID_HOME
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools

# 5. Capacitor CLI
npm install -g @capacitor/cli
```

## Step-by-Step Build

### 1. Install dependencies
```bash
cd android-gateway
npm install
```

### 2. Build the web frontend
```bash
npm run build
```
This creates `dist/` with the compiled React app.

### 3. Add Android platform
```bash
npx cap add android
```
This creates `android/` with the native Android project.

### 4. Sync Capacitor with Android
```bash
npx cap sync
```
This copies the web assets and plugin code into the Android project.

### 5. Build the APK
```bash
# Debug APK (for testing)
cd android
./gradlew assembleDebug

# The APK will be at:
# android/app/build/outputs/apk/debug/app-debug.apk
```

### 6. Install on phone
```bash
# Via ADB (USB debugging enabled)
adb install android/app/build/outputs/apk/debug/app-debug.apk

# Or transfer the APK file to your phone and install manually
```

## Quick Build (One-liner)
```bash
npm run build && npx cap sync && cd android && ./gradlew assembleDebug && cd ..
```

## Server Setup

### 1. Add the gateway routes to your server
Copy the content from `server-gateway-routes.cjs` into your `server.cjs` file. Add the routes before the `app.listen()` call, right after the queue/stats routes.

Search for a good insertion point in server.cjs:
```bash
grep -n "app.listen" server.cjs
```

### 2. Restart the server
```bash
pm2 restart server   # or your process manager
# or
node server.cjs
```

### 3. Configure firewall
Make sure the server's HTTP port (default 3001) is accessible from the Android phone's network.

## Using the App

### First Launch
1. Open NET2APP Gateway on your phone
2. Enter your server URL (e.g., `http://your-server-ip:3001`)
3. Enter a username and password — this becomes the SMPP username/password for the supplier
4. Select "HTTP REST API" (recommended) or "SMPP Inbound"
5. Tap "Test Connection" to verify
6. Tap "Save & Connect"

### Permissions
- Grant SMS permission when prompted
- Grant notification permission for background service
- Allow battery optimization bypass (Settings → Apps → NET2APP Gateway → Battery → Unrestricted)

### Dashboard
- **Status Cards**: See sent/received/delivered counts and uptime
- **Quick Send**: Test sending an SMS directly from the phone
- **Service Status**: Monitor connection health
- **Inbox Tab**: View received (MO) SMS
- **Outbox Tab**: View sent (MT) SMS

## Production APK (Signed Release)

### 1. Generate a keystore
```bash
keytool -genkey -v -keystore net2app-gateway.keystore \
  -alias net2app -keyalg RSA -keysize 2048 -validity 10000
```

### 2. Create `android/key.properties`:
```properties
storePassword=your_store_password
keyPassword=your_key_password
keyAlias=net2app
storeFile=../net2app-gateway.keystore
```

### 3. Build release APK
```bash
cd android && ./gradlew assembleRelease
```

## Troubleshooting

### "SMS permission denied"
- Go to Settings → Apps → NET2APP Gateway → Permissions
- Enable SMS permission manually
- On Android 11+, also enable "Allow background SMS"

### "Battery optimization kills the app"
- Settings → Apps → NET2APP Gateway → Battery → Unrestricted
- Also: Settings → Battery → Battery optimization → All apps → NET2APP Gateway → Don't optimize

### "Server connection fails"
- Check your server firewall allows the HTTP port
- Try using `http://` (not `https://`) for local testing
- Verify the server URL is correct and reachable from the phone

### "No pending MT messages"
- Ensure the supplier is active on the server
- Check that routes are configured to use this supplier
- Look at `sms_outbox` in the database for pending messages
