/**
 * ============================================================
 * NET2APP Gateway — Background Runner
 * ============================================================
 * 
 * This script runs periodically in the background via Capacitor's
 * BackgroundRunner plugin. It sends keepalive heartbeats and 
 * processes pending SMS even when the app is in the background.
 * 
 * Built as a separate entry point for Capacitor BackgroundRunner.
 * ============================================================
 */

// @ts-nocheck
// This runs in the Capacitor background runner context

const GATEWAY_PREFS_KEY = 'net2app_gateway_config';

async function getConfig() {
  try {
    // In background runner, we access storage differently via Capacitor
    const { Capacitor } = globalThis;
    if (Capacitor && Capacitor.getPlatform() === 'android') {
      // Use Android SharedPreferences via Capacitor bridge
      return await Capacitor.Plugins.Storage?.get({ key: GATEWAY_PREFS_KEY })
        .then(r => r.value ? JSON.parse(r.value) : null)
        .catch(() => null);
    }
    return null;
  } catch {
    return null;
  }
}

async function heartbeat(config) {
  if (!config || !config.serverUrl) return;

  const auth = btoa(`${config.username}:${config.password}`);
  
  try {
    const response = await fetch(`${config.serverUrl}/api/gateway/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
        'X-Device-Name': config.deviceName || 'Android-Gateway',
      },
      body: JSON.stringify({
        device_name: config.deviceName,
        timestamp: Date.now(),
      }),
    });

    if (!response.ok) return;

    const data = await response.json();
    
    // Process pending MT messages
    if (data.pending_mt && data.pending_mt.length > 0) {
      for (const msg of data.pending_mt) {
        try {
          // Send via native SMS plugin
          if (window.SmsGatewayPlugin) {
            await window.SmsGatewayPlugin.sendSms(msg.destination, msg.message);
            
            // Acknowledge delivery
            await fetch(`${config.serverUrl}/api/gateway/mt-dlr`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${auth}`,
              },
              body: JSON.stringify({
                message_id: msg.message_id,
                status: 'DELIVRD',
                timestamp: Date.now(),
              }),
            });
          }
        } catch (e) {
          console.error('[BG] MT delivery failed:', e.message);
          // Report failure
          try {
            await fetch(`${config.serverUrl}/api/gateway/mt-dlr`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${auth}`,
              },
              body: JSON.stringify({
                message_id: msg.message_id,
                status: 'FAILED',
                error_code: 'BG_DELIVERY_ERROR',
                timestamp: Date.now(),
              }),
            });
          } catch {}
        }
      }
    }
  } catch (e) {
    console.error('[BG] Heartbeat failed:', e.message);
  }
}

// ============================================================
// Entry point — Capacitor BackgroundRunner calls this
// ============================================================
async function runBackgroundTask() {
  console.log('[BG] Background task running...');
  const config = await getConfig();
  if (config) {
    await heartbeat(config);
  }
}

// Export for Capacitor BackgroundRunner
if (typeof module !== 'undefined' && module.exports) {
  module.exports = runBackgroundTask;
} else {
  runBackgroundTask();
}
