package com.net2app.gateway;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Telephony;
import android.telephony.SmsManager;
import android.telephony.SmsMessage;
import android.util.Log;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.Map;

/**
 * MULTI-NODE gateway engine — completely independent of the Capacitor JS
 * bridge. Started from MainActivity and BootReceiver, so the phone connects
 * to ALL paired hub nodes even if the WebView never calls the plugin.
 */
public class GatewayCore {
    private static final String TAG = "GatewayCore";
    private static final int HEARTBEAT_INTERVAL_MS = 5000;
    private static final int FLUSH_INTERVAL_MS = 5000;
    private static final int FLUSH_REAP_MS = 45000;
    private static final long DLR_REAP_GRACE_MS = 120000;

    public static class NodeConfig {
        public final String url;
        public final String username;
        public final String password;
        public final String apiKey;
        public volatile boolean registered = false;
        public volatile long lastOkAt = 0;
        NodeConfig(String u, String user, String pass, String key) {
            url = u; username = user == null ? "" : user;
            password = pass == null ? "" : pass;
            apiKey = key == null ? "" : key;
        }
    }

    private static volatile boolean started = false;
    private static Context appContext;
    private static final List<NodeConfig> nodes = new ArrayList<>();
    private static final Object nodeLock = new Object();
    private static final Map<String, String> dlrNodeByMsgId = new ConcurrentHashMap<>();
    private static final java.util.Set<String> dlrReported =
            java.util.Collections.synchronizedSet(new java.util.HashSet<>());

    private static Handler handler;
    private static ExecutorService executor;
    private static OfflineQueueManager offlineQueue;
    private static BroadcastReceiver smsReceiver;
    private static BroadcastReceiver dlrReceiver;

    public static boolean isStarted() { return started; }

    // ============================================================
    // LIFECYCLE
    // ============================================================

    /** Idempotent start — safe from MainActivity, plugin and BootReceiver. */
    public static synchronized void start(Context ctx) {
        if (started) return;
        appContext = ctx.getApplicationContext();
        android.content.SharedPreferences prefs =
                appContext.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE);
        loadNodes(prefs);
        if (nodes.isEmpty()) {
            Log.i(TAG, "No nodes configured — engine idle");
            return;
        }
        started = true;
        executor = Executors.newFixedThreadPool(3);
        handler = new Handler(Looper.getMainLooper());
        try {
            offlineQueue = new OfflineQueueManager(appContext);
        } catch (Exception e) {
            Log.w(TAG, "Offline queue init failed: " + e.getMessage());
            offlineQueue = null;
        }
        registerReceivers();
        startForegroundService();
        handler.post(heartbeatLoop);
        handler.postDelayed(flushLoop, FLUSH_INTERVAL_MS);
        handler.postDelayed(reapLoop, FLUSH_REAP_MS);
        executor.execute(GatewayCore::registerAllNodes);
        Log.i(TAG, "GatewayCore started with " + nodes.size() + " node(s)");
    }

    private static final Runnable heartbeatLoop = new Runnable() {
        @Override public void run() {
            List<NodeConfig> snapshot;
            synchronized (nodeLock) { snapshot = new ArrayList<>(nodes); }
            for (final NodeConfig n : snapshot) {
                executor.execute(() -> heartbeatNode(n));
            }
            handler.postDelayed(this, HEARTBEAT_INTERVAL_MS);
        }
    };

    private static final Runnable flushLoop = new Runnable() {
        @Override public void run() {
            executor.execute(GatewayCore::flushQueue);
            handler.postDelayed(this, FLUSH_INTERVAL_MS);
        }
    };

    private static final Runnable reapLoop = new Runnable() {
        @Override public void run() {
            executor.execute(GatewayCore::reapInflight);
            handler.postDelayed(this, FLUSH_REAP_MS);
        }
    };

    // ============================================================
    // NODES PERSISTENCE
    // ============================================================

    private static void loadNodes(android.content.SharedPreferences prefs) {
        synchronized (nodeLock) {
            nodes.clear();
            try {
                String raw = prefs.getString("nodes_json", "");
                if (!raw.isEmpty()) {
                    JSONArray arr = new JSONArray(raw);
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject o = arr.optJSONObject(i);
                        if (o == null) continue;
                        String u = o.optString("url", "").trim();
                        if (u.isEmpty()) continue;
                        if (u.endsWith("/")) u = u.substring(0, u.length() - 1);
                        nodes.add(new NodeConfig(u, o.optString("username", ""),
                                o.optString("password", ""), o.optString("apiKey", "")));
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "nodes_json parse failed: " + e.getMessage());
            }
            // Migration: legacy single-server prefs
            if (nodes.isEmpty()) {
                String legacyUrl = prefs.getString("server_url", "");
                String legacyUser = prefs.getString("username", "");
                if (!legacyUrl.isEmpty() && !legacyUser.isEmpty()) {
                    nodes.add(new NodeConfig(legacyUrl, legacyUser,
                            prefs.getString("password", ""), prefs.getString("api_key", "")));
                }
            }
        }
    }

    /** Re-read nodes from prefs and start if previously idle. */
    public static synchronized void reload(Context ctx) {
        android.content.SharedPreferences prefs =
                ctx.getApplicationContext().getSharedPreferences("sms_gateway", Context.MODE_PRIVATE);
        if (!started) {
            start(ctx);
            return;
        }
        loadNodes(prefs);
    }

    public static void persistNodes() {
        try {
            JSONArray arr = new JSONArray();
            synchronized (nodeLock) {
                for (NodeConfig n : nodes) {
                    JSONObject o = new JSONObject();
                    o.put("url", n.url);
                    o.put("username", n.username);
                    o.put("password", n.password);
                    o.put("apiKey", n.apiKey);
                    arr.put(o);
                }
            }
            appContext.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE)
                    .edit().putString("nodes_json", arr.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "persistNodes failed: " + e.getMessage());
        }
    }

    /** Add or replace one node; registers immediately. Returns true if registered. */
    public static boolean addNode(Context ctx, String url, String user, String pass, String key) {
        if (url == null || url.isEmpty() || user == null || user.isEmpty()) return false;
        if (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        NodeConfig n = new NodeConfig(url, user, pass, key);
        synchronized (nodeLock) {
            for (int i = 0; i < nodes.size(); i++) {
                if (nodes.get(i).url.equals(url)) { nodes.set(i, n); return registerWithServer(n) && setOk(n); }
            }
            nodes.add(n);
        }
        persistNodes();
        start(ctx); // idempotent — spins loops up on first node
        boolean ok = registerWithServer(n);
        if (ok) setOk(n);
        return ok;
    }

    public static boolean removeNode(String url) {
        boolean removed = false;
        synchronized (nodeLock) {
            java.util.Iterator<NodeConfig> it = nodes.iterator();
            while (it.hasNext()) if (it.next().url.equals(url)) { it.remove(); removed = true; }
        }
        if (removed) persistNodes();
        return removed;
    }

    public static JSONArray nodesStatusJson() {
        JSONArray arr = new JSONArray();
        synchronized (nodeLock) {
            for (NodeConfig n : nodes) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("url", n.url);
                    o.put("username", n.username);
                    o.put("connected", n.registered);
                    o.put("lastOkAt", n.lastOkAt);
                    arr.put(o);
                } catch (Exception ignored) {}
            }
        }
        return arr;
    }

    public static int registeredCount() {
        int c = 0;
        synchronized (nodeLock) { for (NodeConfig n : nodes) if (n.registered) c++; }
        return c;
    }

    public static int totalCount() {
        synchronized (nodeLock) { return nodes.size(); }
    }

    // ============================================================
    // HTTP — register / heartbeat / MO / DLR (multi-node)
    // ============================================================

    private static void registerAllNodes() {
        List<NodeConfig> snapshot;
        synchronized (nodeLock) { snapshot = new ArrayList<>(nodes); }
        for (NodeConfig n : snapshot) {
            if (registerWithServer(n)) setOk(n);
        }
    }

    private static boolean setOk(NodeConfig n) {
        n.registered = true;
        n.lastOkAt = System.currentTimeMillis();
        return true;
    }

    private static boolean registerWithServer(NodeConfig n) {
        try {
            java.net.URL url = new java.net.URL(n.url + "/api/gateway/register");
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);
            JSONObject payload = new JSONObject();
            payload.put("username", n.username);
            payload.put("password", n.password);
            payload.put("device_name", Build.MODEL + " (" + Build.MANUFACTURER + ")");
            java.io.OutputStream os = conn.getOutputStream();
            os.write(payload.toString().getBytes("UTF-8"));
            os.close();
            int status = conn.getResponseCode();
            Log.i(TAG, "register [" + n.url + "] -> HTTP " + status);
            return status == 200 || status == 201;
        } catch (Exception e) {
            Log.w(TAG, "register [" + n.url + "] error: " + e.getMessage());
            return false;
        }
    }

    private static void heartbeatNode(NodeConfig n) {
        try {
            String auth = android.util.Base64.encodeToString(
                    (n.username + ":" + n.password).getBytes("UTF-8"), android.util.Base64.NO_WRAP);
            java.net.URL url = new java.net.URL(n.url + "/api/gateway/heartbeat");
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Basic " + auth);
            if (!n.apiKey.isEmpty()) conn.setRequestProperty("X-API-Key", n.apiKey);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);
            JSONObject payload = new JSONObject();
            payload.put("device_name", Build.MODEL);
            payload.put("android_version", "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
            payload.put("sim_ready", isSimReady());
            payload.put("sim_carrier", getSimCarrier());
            payload.put("sim_number", getSimNumber());
            payload.put("pending_mt_count", offlineQueue != null ? offlineQueue.getPendingCount() : 0);
            java.io.OutputStream os = conn.getOutputStream();
            os.write(payload.toString().getBytes("UTF-8"));
            os.close();
            int status = conn.getResponseCode();
            if (status == 200) {
                setOk(n);
                java.io.BufferedReader reader = new java.io.BufferedReader(
                        new java.io.InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
                reader.close();
                JSONObject resp = new JSONObject(sb.toString());
                if (resp.has("pending_mt")) {
                    JSONArray pendingMt = resp.getJSONArray("pending_mt");
                    for (int i = 0; i < pendingMt.length(); i++) {
                        JSONObject mt = pendingMt.getJSONObject(i);
                        String msgId = mt.optString("message_id", "");
                        String dest = mt.optString("destination", "");
                        String msg = mt.optString("message", "");
                        if (!dest.isEmpty()) {
                            if (!msgId.isEmpty()) dlrNodeByMsgId.put(msgId, n.url);
                            sendSmsViaAndroid(dest, msg, msgId);
                        }
                    }
                }
            } else {
                Log.w(TAG, "heartbeat [" + n.url + "] -> HTTP " + status);
                n.registered = false;
            }
        } catch (Exception e) {
            Log.w(TAG, "heartbeat [" + n.url + "] error: " + e.getMessage());
            n.registered = false;
        }
    }

    /** MO SMS fan-out to every node. */
    private static boolean sendMoViaHttp(String from, String text, long timestamp) {
        List<NodeConfig> snapshot;
        synchronized (nodeLock) { snapshot = new ArrayList<>(nodes); }
        boolean anyOk = false;
        for (NodeConfig n : snapshot) {
            try {
                String auth = android.util.Base64.encodeToString(
                        (n.username + ":" + n.password).getBytes("UTF-8"), android.util.Base64.NO_WRAP);
                java.net.URL url = new java.net.URL(n.url + "/api/gateway/mo-sms");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Basic " + auth);
                if (!n.apiKey.isEmpty()) conn.setRequestProperty("X-API-Key", n.apiKey);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setDoOutput(true);
                JSONObject payload = new JSONObject();
                payload.put("from", from);
                payload.put("text", text);
                payload.put("timestamp", timestamp);
                payload.put("device_name", Build.MODEL);
                java.io.OutputStream os = conn.getOutputStream();
                os.write(payload.toString().getBytes("UTF-8"));
                os.close();
                anyOk |= conn.getResponseCode() == 200;
            } catch (Exception e) {
                Log.w(TAG, "MO forward [" + n.url + "] failed: " + e.getMessage());
            }
        }
        if (anyOk && offlineQueue != null) offlineQueue.markSentBySource(from, text, timestamp);
        return anyOk;
    }

    /** DLR to the issuing node; falls back to all nodes. */
    private static boolean sendDlrViaHttp(String msgId, String dlrStatus, String errorCode) {
        String nodeUrl = dlrNodeByMsgId.remove(msgId);
        if (nodeUrl != null) {
            NodeConfig target = null;
            synchronized (nodeLock) {
                for (NodeConfig n : nodes) if (n.url.equals(nodeUrl)) { target = n; break; }
            }
            if (target != null && postDlr(target, msgId, dlrStatus, errorCode)) return true;
        }
        List<NodeConfig> snapshot;
        synchronized (nodeLock) { snapshot = new ArrayList<>(nodes); }
        boolean anyOk = false;
        for (NodeConfig n : snapshot) {
            if (postDlr(n, msgId, dlrStatus, errorCode)) anyOk = true;
        }
        return anyOk;
    }

    private static boolean postDlr(NodeConfig n, String msgId, String dlrStatus, String errorCode) {
        try {
            String auth = android.util.Base64.encodeToString(
                    (n.username + ":" + n.password).getBytes("UTF-8"), android.util.Base64.NO_WRAP);
            java.net.URL url = new java.net.URL(n.url + "/api/gateway/mt-dlr");
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Basic " + auth);
            if (!n.apiKey.isEmpty()) conn.setRequestProperty("X-API-Key", n.apiKey);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);
            JSONObject payload = new JSONObject();
            payload.put("message_id", msgId);
            payload.put("status", dlrStatus);
            payload.put("error_code", errorCode);
            java.io.OutputStream os = conn.getOutputStream();
            os.write(payload.toString().getBytes("UTF-8"));
            os.close();
            return conn.getResponseCode() == 200;
        } catch (Exception e) {
            Log.w(TAG, "DLR [" + n.url + "] failed: " + e.getMessage());
            return false;
        }
    }

    // ============================================================
    // SMS SENDING / RECEIVING
    // ============================================================

    private static final String ACTION_SMS_SENT = "com.net2app.gateway.SMS_SENT";
    private static final String ACTION_SMS_DELIVERED = "com.net2app.gateway.SMS_DELIVERED";

    private static void sendSmsViaAndroid(String destination, String message, String serverMsgId) {
        try {
            SmsManager smsManager = SmsManager.getDefault();
            ArrayList<String> parts = smsManager.divideMessage(message);
            ArrayList<android.app.PendingIntent> sentIntents = new ArrayList<>();
            ArrayList<android.app.PendingIntent> deliveredIntents = new ArrayList<>();
            for (int i = 0; i < parts.size(); i++) {
                Intent sentIntent = new Intent(ACTION_SMS_SENT).setPackage(appContext.getPackageName());
                sentIntent.putExtra("server_msg_id", serverMsgId != null ? serverMsgId : destination);
                sentIntent.putExtra("part_index", i);
                sentIntent.putExtra("part_count", parts.size());
                sentIntents.add(android.app.PendingIntent.getBroadcast(appContext,
                        (serverMsgId != null ? serverMsgId : destination).hashCode() + i,
                        sentIntent, android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT));
                Intent deliveredIntent = new Intent(ACTION_SMS_DELIVERED).setPackage(appContext.getPackageName());
                deliveredIntent.putExtra("server_msg_id", serverMsgId != null ? serverMsgId : destination);
                deliveredIntent.putExtra("part_index", i);
                deliveredIntent.putExtra("part_count", parts.size());
                deliveredIntents.add(android.app.PendingIntent.getBroadcast(appContext,
                        (serverMsgId != null ? serverMsgId : destination).hashCode() + 1000 + i,
                        deliveredIntent, android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT));
            }
            smsManager.sendMultipartTextMessage(destination, null, parts, sentIntents, deliveredIntents);
            if (serverMsgId != null) {
                appContext.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE)
                        .edit().putLong("inflight_" + serverMsgId, System.currentTimeMillis()).apply();
            }
            Log.i(TAG, "MT dispatched to " + destination);
        } catch (Exception e) {
            Log.e(TAG, "MT send failed: " + e.getMessage());
            if (offlineQueue != null && serverMsgId != null) {
                offlineQueue.enqueueMtDlr(serverMsgId, "FAILED:001", System.currentTimeMillis(), "FAILED");
            }
        }
    }

    private static void registerReceivers() {
        dlrReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context ctx, Intent intent) {
                String msgId = intent.getStringExtra("server_msg_id");
                if (msgId == null) return;
                boolean delivered = ACTION_SMS_DELIVERED.equals(intent.getAction());
                int rc = getResultCode();
                if (!delivered && rc != android.app.Activity.RESULT_OK) {
                    if (rc == android.telephony.SmsManager.RESULT_ERROR_GENERIC_FAILURE
                            || rc == android.telephony.SmsManager.RESULT_ERROR_RADIO_OFF
                            || rc == android.telephony.SmsManager.RESULT_ERROR_NO_SERVICE) {
                        if (dlrReported.add(msgId)) {
                            clearInflight(msgId);
                            if (offlineQueue != null) {
                                offlineQueue.enqueueMtDlr(msgId, "FAILED:" + rc, System.currentTimeMillis(), "FAILED");
                            } else {
                                executor.execute(() -> sendDlrViaHttp(msgId, "FAILED", String.valueOf(rc)));
                            }
                        }
                    }
                    return;
                }
                if (delivered) {
                    boolean ok = rc == android.app.Activity.RESULT_OK;
                    if (dlrReported.add(msgId)) {
                        clearInflight(msgId);
                        String st = ok ? "DELIVRD" : "UNDELIV";
                        String code = ok ? "000" : String.valueOf(rc);
                        if (offlineQueue != null) {
                            offlineQueue.enqueueMtDlr(msgId, st + ":" + code, System.currentTimeMillis(), st);
                        } else {
                            executor.execute(() -> sendDlrViaHttp(msgId, st, code));
                        }
                    }
                }
            }
        };
        IntentFilter dlrFilter = new IntentFilter();
        dlrFilter.addAction(ACTION_SMS_SENT);
        dlrFilter.addAction(ACTION_SMS_DELIVERED);
        registerReceiverCompat(dlrReceiver, dlrFilter);

        smsReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context ctx, Intent intent) {
                android.os.Bundle bundle = intent.getExtras();
                if (bundle == null) return;
                Object[] pdus = (Object[]) bundle.get("pdus");
                if (pdus == null) return;
                for (Object pdu : pdus) {
                    SmsMessage sms = SmsMessage.createFromPdu((byte[]) pdu, bundle.getString("format"));
                    final String from = sms.getDisplayOriginatingAddress();
                    final String body = sms.getDisplayMessageBody();
                    final long ts = sms.getTimestampMillis();
                    Log.i(TAG, "MO SMS from " + from);
                    if (offlineQueue != null) offlineQueue.enqueueMoSms(from, body, ts);
                    executor.execute(() -> sendMoViaHttp(from, body, ts));
                }
            }
        };
        IntentFilter smsFilter = new IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION);
        registerReceiverCompat(smsReceiver, smsFilter);
        Log.i(TAG, "Receivers registered");
    }

    private static void registerReceiverCompat(BroadcastReceiver r, IntentFilter f) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            appContext.registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED);
        } else {
            appContext.registerReceiver(r, f);
        }
    }

    private static void clearInflight(String msgId) {
        appContext.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE)
                .edit().remove("inflight_" + msgId).apply();
    }

    private static void reapInflight() {
        try {
            android.content.SharedPreferences prefs =
                    appContext.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE);
            Map<String, ?> inflight = prefs.getAll();
            long now = System.currentTimeMillis();
            for (Map.Entry<String, ?> e : inflight.entrySet()) {
                String key = e.getKey();
                if (!key.startsWith("inflight_")) continue;
                long dispatchedAt = Long.parseLong(String.valueOf(e.getValue()));
                if (now - dispatchedAt > DLR_REAP_GRACE_MS) {
                    String msgId = key.substring("inflight_".length());
                    if (dlrReported.add(msgId)) {
                        Log.w(TAG, "Reaping MT " + msgId + " as UNDELIV");
                        executor.execute(() -> sendDlrViaHttp(msgId, "UNDELIV", "900"));
                    }
                    prefs.edit().remove(key).apply();
                }
            }
        } catch (Exception ex) {
            Log.w(TAG, "reaper failed: " + ex.getMessage());
        }
    }

    private static int flushQueue() {
        if (offlineQueue == null) return 0;
        int flushed = 0;
        List<OfflineMessage> pending = offlineQueue.getPendingBatch(20);
        for (OfflineMessage msg : pending) {
            boolean ok = false;
            try {
                if ("mo".equals(msg.direction)) {
                    ok = sendMoViaHttp(msg.fromAddress, msg.messageText, msg.receivedAt);
                } else if ("dlr".equals(msg.direction)) {
                    String[] p = msg.messageText.split(":", 2);
                    ok = sendDlrViaHttp(msg.fromAddress,
                            p.length > 1 ? p[0] : "DELIVRD",
                            p.length > 1 ? p[1] : "000");
                }
            } catch (Exception ignored) {}
            if (ok) { offlineQueue.markSent(msg.id); flushed++; }
            else offlineQueue.recordAttempt(msg.id);
        }
        return flushed;
    }

    private static void startForegroundService() {
        try {
            Intent svc = new Intent(appContext, GatewayService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appContext.startForegroundService(svc);
            } else {
                appContext.startService(svc);
            }
        } catch (Exception e) {
            Log.e(TAG, "GatewayService start failed: " + e.getMessage());
        }
    }

    // ============================================================
    // DEVICE HELPERS
    // ============================================================

    private static boolean isSimReady() {
        try {
            android.telephony.TelephonyManager tm =
                    (android.telephony.TelephonyManager) appContext.getSystemService(Context.TELEPHONY_SERVICE);
            return tm != null && tm.getSimState() == android.telephony.TelephonyManager.SIM_STATE_READY;
        } catch (Exception e) { return false; }
    }

    private static String getSimCarrier() {
        try {
            android.telephony.TelephonyManager tm =
                    (android.telephony.TelephonyManager) appContext.getSystemService(Context.TELEPHONY_SERVICE);
            if (tm == null) return "";
            String name = tm.getSimOperatorName();
            if (name == null || name.isEmpty()) name = tm.getNetworkOperatorName();
            return name != null ? name : "";
        } catch (Exception e) { return ""; }
    }

    private static String getSimNumber() {
        try {
            if (ContextCompat.checkSelfPermission(appContext, Manifest.permission.READ_PHONE_STATE)
                    != PackageManager.PERMISSION_GRANTED) return "";
            android.telephony.TelephonyManager tm =
                    (android.telephony.TelephonyManager) appContext.getSystemService(Context.TELEPHONY_SERVICE);
            String n = tm != null ? tm.getLine1Number() : null;
            return n != null ? n : "";
        } catch (Exception e) { return ""; }
    }
}
