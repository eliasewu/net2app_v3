package com.net2app.gateway;

import android.content.Context;
import android.util.Log;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Plain WebView JS bridge (bypasses Capacitor plugin layer). The JS app calls
 * window.Net2appNative.* to persist the multi-node config natively and start
 * the GatewayCore engine — works even if the Capacitor plugin bridge fails.
 */
public class ConfigBridge {
    private static final String TAG = "ConfigBridge";
    private final Context context;

    public ConfigBridge(Context ctx) {
        context = ctx.getApplicationContext();
    }

    /**
     * Called from JS: window.Net2appNative.saveConfig(JSON.stringify(config))
     * config: { serverUrl, username, password, apiKey, nodes: [{url, username, password, apiKey}] }
     */
    @JavascriptInterface
    public String saveConfig(String json) {
        try {
            JSONObject cfg = new JSONObject(json);
            JSONArray nodesIn = cfg.optJSONArray("nodes");
            android.content.SharedPreferences.Editor ed = context
                    .getSharedPreferences("sms_gateway", Context.MODE_PRIVATE).edit();

            // Build node list: explicit nodes[] or derive from single serverUrl
            JSONArray nodesOut = new JSONArray();
            if (nodesIn != null && nodesIn.length() > 0) {
                for (int i = 0; i < nodesIn.length(); i++) {
                    JSONObject n = nodesIn.optJSONObject(i);
                    if (n == null) continue;
                    String url = n.optString("url", "").trim();
                    if (url.isEmpty()) continue;
                    if (url.endsWith("/")) url = url.substring(0, url.length() - 1);
                    JSONObject o = new JSONObject();
                    o.put("url", url);
                    o.put("username", n.optString("username", ""));
                    o.put("password", n.optString("password", ""));
                    o.put("apiKey", n.optString("apiKey", ""));
                    nodesOut.put(o);
                }
            } else {
                String url = cfg.optString("serverUrl", "").trim();
                if (url.endsWith("/")) url = url.substring(0, url.length() - 1);
                if (!url.isEmpty()) {
                    JSONObject o = new JSONObject();
                    o.put("url", url);
                    o.put("username", cfg.optString("username", ""));
                    o.put("password", cfg.optString("password", ""));
                    o.put("apiKey", cfg.optString("apiKey", ""));
                    nodesOut.put(o);
                }
            }
            if (nodesOut.length() == 0) {
                return "error: no valid nodes";
            }
            // Mirror first node into legacy keys (BootReceiver / old UIs)
            JSONObject first = nodesOut.getJSONObject(0);
            ed.putString("server_url", first.getString("url"));
            ed.putString("username", first.getString("username"));
            ed.putString("password", first.getString("password"));
            ed.putString("api_key", first.optString("apiKey", ""));
            ed.putString("nodes_json", nodesOut.toString());
            ed.apply();

            // Boot the engine immediately (idempotent)
            GatewayCore.start(context);
            GatewayCore.reload(context);
            Log.i(TAG, "Config saved via JS bridge: " + nodesOut.length() + " node(s)");
            return "ok:" + nodesOut.length();
        } catch (Exception e) {
            Log.e(TAG, "saveConfig failed: " + e.getMessage());
            return "error:" + e.getMessage();
        }
    }

    /** JS: window.Net2appNative.addNode(JSON.stringify({url, username, password, apiKey})) */
    @JavascriptInterface
    public String addNode(String json) {
        try {
            JSONObject n = new JSONObject(json);
            String url = n.optString("url", "").trim();
            if (url.endsWith("/")) url = url.substring(0, url.length() - 1);
            boolean ok = GatewayCore.addNode(context, url,
                    n.optString("username", ""), n.optString("password", ""),
                    n.optString("apiKey", ""));
            GatewayCore.persistNodes();
            return ok ? "ok" : "error:register-failed";
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    /** JS: window.Net2appNative.removeNode(url) */
    @JavascriptInterface
    public String removeNode(String url) {
        return GatewayCore.removeNode(url) ? "ok" : "error:not-found";
    }

    /** JS: window.Net2appNative.status() → JSON {nodes:[{url,connected,lastOkAt}], count} */
    @JavascriptInterface
    public String status() {
        try {
            JSONObject o = new JSONObject();
            o.put("nodes", GatewayCore.nodesStatusJson());
            o.put("registeredCount", GatewayCore.registeredCount());
            o.put("totalCount", GatewayCore.totalCount());
            o.put("engineStarted", GatewayCore.isStarted());
            o.put("smsPermissionGranted", hasSmsPermissions());
            return o.toString();
        } catch (Exception e) {
            return "{\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    private boolean hasSmsPermissions() {
        return context.checkSelfPermission(android.Manifest.permission.SEND_SMS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED
            && context.checkSelfPermission(android.Manifest.permission.RECEIVE_SMS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED
            && context.checkSelfPermission(android.Manifest.permission.READ_SMS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    /** JS: window.Net2appNative.sendSms(to, text) — uses the phone SIM. */
    @JavascriptInterface
    public String sendSms(String to, String text) {
        try {
            android.telephony.SmsManager sm = android.telephony.SmsManager.getDefault();
            sm.sendMultipartTextMessage(to, null, sm.divideMessage(text), null, null);
            return "ok";
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }
}
