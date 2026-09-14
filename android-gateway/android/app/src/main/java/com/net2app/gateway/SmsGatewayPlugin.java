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

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "SmsGateway")
public class SmsGatewayPlugin extends Plugin {

    private static final String TAG = "SmsGatewayPlugin";
    private static final int SMS_PERMISSION_CODE = 1001;

    private Activity activity;
    private Context context;
    private ExecutorService executor;
    private PluginCall pendingPermissionCall;

    // HTTP heartbeat config
    private String serverUrl = "";
    private String username = "";
    private String password = "";
    private String apiKey = "";
    private boolean isRegistered = false;

    // SMPP integration
    private SmppGatewayClient smppClient;
    private volatile boolean smppEnabled = false;

    // Offline queue
    private OfflineQueueManager offlineQueue;

    // Heartbeat timer
    private Handler heartbeatHandler;
    private Runnable heartbeatRunnable;
    private static final int HEARTBEAT_INTERVAL_MS = 5000;

    // SMS receiver
    private BroadcastReceiver smsReceiver;
    private boolean smsReceiverRegistered = false;

    // Queue flusher
    private Handler flushHandler;
    private Runnable flushRunnable;
    private static final int FLUSH_INTERVAL_MS = 5000;

    // Real DLR tracking (delivery broadcast intents)
    private static final String ACTION_SMS_SENT = "com.net2app.gateway.SMS_SENT";
    private static final String ACTION_SMS_DELIVERED = "com.net2app.gateway.SMS_DELIVERED";
    private static final String EXTRA_MSG_ID = "server_msg_id";
    private static final String EXTRA_PART = "part_index";
    private static final String EXTRA_PARTS = "part_count";
    private static final String EXTRA_DEST = "destination";
    private BroadcastReceiver dlrReceiver;
    private boolean dlrReceiverRegistered = false;
    /** msgIds already enqueued for server DLR — prevents duplicate POSTs across parts */
    private final java.util.Set<String> dlrReported = java.util.Collections.synchronizedSet(new java.util.HashSet<>());
    private Handler dlrReaperHandler;
    private static final int FLUSH_REAP_MS = 45000;   // DLR reaper pass
    private static final long DLR_REAP_GRACE_MS = 120000; // mark UNDELIV if no broadcast within 2 min

    @Override
    public void load() {
        activity = getActivity();
        context = getContext();
        executor = Executors.newSingleThreadExecutor();

        // Initialize offline queue
        offlineQueue = new OfflineQueueManager(context);
        offlineQueue.setChangeListener(pending -> notifyQueueChanged(pending));

        // Log startup
        Log.i(TAG, "SmsGatewayPlugin loaded");

        // Auto-start: restore saved config and bring the gateway up again after
        // an app restart, so the background heartbeat/receivers survive without
        // the user pressing Save & Connect every time.
        android.content.SharedPreferences prefs = context.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE);
        String savedUrl = prefs.getString("server_url", "");
        String savedUser = prefs.getString("username", "");
        if (!savedUrl.isEmpty() && !savedUser.isEmpty()) {
            serverUrl = savedUrl;
            username = savedUser;
            password = prefs.getString("password", "");
            apiKey = prefs.getString("api_key", "");
            smppEnabled = prefs.getBoolean("smpp_enabled", false);
            executor.execute(() -> {
                boolean registered = registerWithServer();
                if (registered) {
                    isRegistered = true;
                    startHeartbeat();
                    startQueueFlusher();
                    startDlrReaper();
                    registerSmsReceiver();
                    registerDlrReceiver();
                    Log.i(TAG, "Gateway auto-started from saved config: " + username);
                }
            });
        }
    }

    /** True when all SMS runtime permissions are granted. */
    private boolean hasSmsPermissions() {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    /** Current permission state — lets the UI reflect reality after the user returns from Settings. */
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = hasSmsPermissions();
        result.put("granted", granted);
        java.util.List<String> missing = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.SEND_SMS);
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.RECEIVE_SMS);
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.READ_SMS);
        result.put("missing", new JSONArray(missing));
        call.resolve(result);
    }

    /** Opens the system App Settings page — required when the user checked "Don't ask again". */
    @PluginMethod
    public void openPermissionSettings(PluginCall call) {
        try {
            android.content.Intent i = new android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            i.setData(android.net.Uri.parse("package:" + context.getPackageName()));
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(i);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not open settings: " + e.getMessage());
        }
    }

    /**
     * Resolves the pending JS permission call when the user answers the system
     * dialog. BridgeActivity forwards the result here from MainActivity.
     */
    public void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != SMS_PERMISSION_CODE || pendingPermissionCall == null) return;
        PluginCall call = pendingPermissionCall;
        pendingPermissionCall = null;

        boolean allGranted = grantResults.length > 0;
        for (int r : grantResults) {
            if (r != PackageManager.PERMISSION_GRANTED) { allGranted = false; break; }
        }
        JSObject result = new JSObject();
        result.put("granted", allGranted);
        if (!allGranted) {
            result.put("message", "SMS permissions were not fully granted — the gateway cannot send or receive SMS. Grant them in Settings → Apps → Net2appPro → Permissions.");
        }
        call.resolve(result);
        Log.i(TAG, "Permission result: granted=" + allGranted);
    }

    // ============================================================
    // CAPACITOR PLUGIN METHODS
    // ============================================================

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            List<String> permissions = new ArrayList<>();
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS)
                    != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.SEND_SMS);
            }
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS)
                    != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.RECEIVE_SMS);
            }
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS)
                    != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.READ_SMS);
            }
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_BOOT_COMPLETED)
                    != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.RECEIVE_BOOT_COMPLETED);
            }

            if (permissions.isEmpty()) {
                JSObject result = new JSObject();
                result.put("granted", true);
                result.put("permissions", new JSONArray());
                call.resolve(result);
            } else {
                // Keep the call until the user answers the system dialog; it is
                // resolved in handleRequestPermissionsResult below.
                pendingPermissionCall = call;
                ActivityCompat.requestPermissions(activity,
                        permissions.toArray(new String[0]), SMS_PERMISSION_CODE);
            }
        } else {
            JSObject result = new JSObject();
            result.put("granted", true);
            result.put("permissions", new JSONArray());
            call.resolve(result);
        }
    }

    @PluginMethod
    public void configure(PluginCall call) {
        serverUrl = call.getString("serverUrl", "");
        username = call.getString("username", "");
        password = call.getString("password", "");
        apiKey = call.getString("apiKey", "");
        smppEnabled = call.getBoolean("smppEnabled", false);

        // Strip trailing slash
        if (serverUrl.endsWith("/")) {
            serverUrl = serverUrl.substring(0, serverUrl.length() - 1);
        }

        // Save to shared preferences
        activity.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE)
                .edit()
                .putString("server_url", serverUrl)
                .putString("username", username)
                .putString("password", password)
                .putString("api_key", apiKey)
                .putBoolean("smpp_enabled", smppEnabled)
                .apply();

        if (serverUrl.isEmpty() || username.isEmpty()) {
            call.reject("Server URL and username are required");
            return;
        }

        executor.execute(() -> {
            // Register with server
            boolean registered = registerWithServer();
            if (registered) {
                isRegistered = true;
                startHeartbeat();
                startQueueFlusher();
                startDlrReaper();
                registerSmsReceiver();
                registerDlrReceiver();
                Log.i(TAG, "Gateway configured and registered: " + username);
            }

            JSObject result = new JSObject();
            result.put("success", registered);
            result.put("username", username);
            result.put("serverUrl", serverUrl);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("isRegistered", isRegistered);
        result.put("serverUrl", serverUrl);
        result.put("username", username);
        result.put("smsReceiverActive", smsReceiverRegistered);
        result.put("smsPermissionGranted", hasSmsPermissions());
        result.put("offlineQueuePending", offlineQueue != null ? offlineQueue.getPendingCount() : 0);
        result.put("smppEnabled", smppEnabled);
        if (smppClient != null) {
            result.put("smppConnected", smppClient.isConnected());
        } else {
            result.put("smppConnected", false);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void sendSms(PluginCall call) {
        String phoneNumber = call.getString("phoneNumber");
        String message = call.getString("message");

        if (phoneNumber == null || message == null) {
            call.reject("phoneNumber and message are required");
            return;
        }

        try {
            SmsManager smsManager = SmsManager.getDefault();
            ArrayList<String> parts = smsManager.divideMessage(message);

            smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null);
            Log.i(TAG, "SMS sent to " + phoneNumber + " (" + parts.size() + " parts)");

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("parts", parts.size());
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Failed to send SMS: " + e.getMessage());
            // Queue offline for retry
            if (offlineQueue != null) {
                offlineQueue.enqueueMtDlr(phoneNumber, message, System.currentTimeMillis(), "PENDING");
            }
            call.reject("Failed to send SMS: " + e.getMessage());
        }
    }

    @PluginMethod
    public void connectSmpp(PluginCall call) {
        String smppHost = call.getString("host");
        int smppPort = call.getInt("port", 2775);
        String smppUser = call.getString("systemId", username);
        String smppPass = call.getString("password", password);

        executor.execute(() -> {
            try {
                if (smppClient != null) {
                    smppClient.shutdown();
                }
                smppClient = new SmppGatewayClient(smppHost, smppPort, smppUser, smppPass);
                smppClient.setSmsSender(this::sendSmsViaAndroid);
                smppClient.setMoHandler(this::forwardMoViaSmpp);
                smppClient.setDlrHandler(this::reportDlrViaSmpp);
                smppClient.connect();

                JSObject result = new JSObject();
                result.put("success", true);
                result.put("connecting", true);
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "SMPP connect failed: " + e.getMessage());
                call.reject("SMPP connect failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void disconnectSmpp(PluginCall call) {
        executor.execute(() -> {
            if (smppClient != null) {
                smppClient.shutdown();
                smppClient = null;
            }
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void getSmppStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("connected", smppClient != null && smppClient.isConnected());
        result.put("bound", smppClient != null && smppClient.isBound());
        call.resolve(result);
    }

    @PluginMethod
    public void getOfflineQueueStats(PluginCall call) {
        JSObject result = new JSObject();
        if (offlineQueue != null) {
            result.put("pending", offlineQueue.getPendingCount());
            result.put("total", offlineQueue.getTotalCount());
        } else {
            result.put("pending", 0);
            result.put("total", 0);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void flushOfflineQueue(PluginCall call) {
        executor.execute(() -> {
            int flushed = flushQueue();
            JSObject result = new JSObject();
            result.put("flushed", flushed);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void loadSavedConfig(PluginCall call) {
        android.content.SharedPreferences prefs =
                activity.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("serverUrl", prefs.getString("server_url", ""));
        result.put("username", prefs.getString("username", ""));
        result.put("password", prefs.getString("password", ""));
        result.put("apiKey", prefs.getString("api_key", ""));
        result.put("smppEnabled", prefs.getBoolean("smpp_enabled", false));
        call.resolve(result);
    }

    // ============================================================
    // HTTP SERVER COMMUNICATION
    // ============================================================

    private boolean registerWithServer() {
        try {
            java.net.URL url = new java.net.URL(serverUrl + "/api/gateway/register");
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);

            JSONObject payload = new JSONObject();
            payload.put("username", username);
            payload.put("password", password);
            payload.put("device_name", Build.MODEL + " (" + Build.MANUFACTURER + ")");

            java.io.OutputStream os = conn.getOutputStream();
            os.write(payload.toString().getBytes("UTF-8"));
            os.close();

            int status = conn.getResponseCode();
            if (status == 200 || status == 201) {
                Log.i(TAG, "Registered with server: " + username);
                return true;
            } else {
                Log.e(TAG, "Server registration failed: HTTP " + status);
                return false;
            }
        } catch (Exception e) {
            Log.e(TAG, "Server registration error: " + e.getMessage());
            return false;
        }
    }

    private void doHeartbeat() {
        executor.execute(() -> {
            try {
                String auth = android.util.Base64.encodeToString(
                        (username + ":" + password).getBytes("UTF-8"),
                        android.util.Base64.NO_WRAP);

                java.net.URL url = new java.net.URL(serverUrl + "/api/gateway/heartbeat");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Basic " + auth);
                conn.setRequestProperty("X-API-Key", apiKey);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setDoOutput(true);

                JSONObject payload = new JSONObject();
                payload.put("device_name", Build.MODEL);
                payload.put("pending_mt_count", offlineQueue != null ? offlineQueue.getPendingCount() : 0);

                java.io.OutputStream os = conn.getOutputStream();
                os.write(payload.toString().getBytes("UTF-8"));
                os.close();

                int status = conn.getResponseCode();
                if (status == 200) {
                    isRegistered = true;
                    // Read pending MT messages
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
                                // DLR is reported by the delivery broadcast receiver
                                // (real handset status), NOT optimistically here.
                                sendSmsViaAndroid(dest, msg, msgId);
                            }
                        }
                    }
                } else {
                    Log.w(TAG, "Heartbeat failed: HTTP " + status);
                    isRegistered = false;
                    // Retry registration on next beat; do not block the executor
                }
            } catch (Exception e) {
                Log.w(TAG, "Heartbeat error: " + e.getMessage());
                isRegistered = false;
            }
        });
    }

    // ============================================================
    // SMS SENDING / RECEIVING
    // ============================================================

    private void sendSmsViaAndroid(String destination, String message) {
        sendSmsViaAndroid(destination, message, null);
    }

    /**
     * Send an MT SMS via the handset and register pending-intent broadcasts so
     * the REAL delivery status is reported back (not an optimistic DELIVRD).
     * If the delivery broadcast never arrives, a reaper marks the DLR UNDELIV
     * so the server is never left waiting forever.
     */
    private void sendSmsViaAndroid(String destination, String message, String serverMsgId) {
        try {
            SmsManager smsManager = SmsManager.getDefault();
            ArrayList<String> parts = smsManager.divideMessage(message);

            ArrayList<android.app.PendingIntent> sentIntents = new ArrayList<>();
            ArrayList<android.app.PendingIntent> deliveredIntents = new ArrayList<>();

            for (int i = 0; i < parts.size(); i++) {
                Intent sentIntent = new Intent(ACTION_SMS_SENT).setPackage(context.getPackageName());
                sentIntent.putExtra(EXTRA_MSG_ID, serverMsgId != null ? serverMsgId : destination);
                sentIntent.putExtra(EXTRA_PART, i);
                sentIntent.putExtra(EXTRA_PARTS, parts.size());
                sentIntent.putExtra(EXTRA_DEST, destination);
                sentIntents.add(android.app.PendingIntent.getBroadcast(context,
                        (serverMsgId != null ? serverMsgId : destination).hashCode() + i,
                        sentIntent, android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT));

                Intent deliveredIntent = new Intent(ACTION_SMS_DELIVERED).setPackage(context.getPackageName());
                deliveredIntent.putExtra(EXTRA_MSG_ID, serverMsgId != null ? serverMsgId : destination);
                deliveredIntent.putExtra(EXTRA_PART, i);
                deliveredIntent.putExtra(EXTRA_PARTS, parts.size());
                deliveredIntent.putExtra(EXTRA_DEST, destination);
                deliveredIntents.add(android.app.PendingIntent.getBroadcast(context,
                        (serverMsgId != null ? serverMsgId : destination).hashCode() + 1000 + i,
                        deliveredIntent, android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT));
            }

            smsManager.sendMultipartTextMessage(destination, null, parts,
                    sentIntents, deliveredIntents);
            // Track in-flight so the reaper can resolve it if broadcasts are lost
            if (serverMsgId != null) {
                context.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE)
                        .edit()
                        .putLong("inflight_" + serverMsgId, System.currentTimeMillis())
                        .apply();
            }
            Log.i(TAG, "MT SMS dispatched to " + destination + " (" + parts.size() + " parts, dlr tracked)" );
        } catch (Exception e) {
            Log.e(TAG, "Failed to send MT SMS: " + e.getMessage());
            // Send never happened — report FAILED to the server (queued for retry)
            if (offlineQueue != null && serverMsgId != null) {
                offlineQueue.enqueueMtDlr(serverMsgId, "FAILED:001", System.currentTimeMillis(), "FAILED");
            }
        }
    }

    private void forwardMoViaSmpp(String from, String text, long timestamp) {
        // Forward MO SMS to server via HTTP
        enqueueMoToDb(from, text, timestamp);
    }

    private void enqueueMoToDb(String from, String text, long timestamp) {
        if (offlineQueue != null) {
            offlineQueue.enqueueMoSms(from, text, timestamp);
        }
        // Try to send immediately via HTTP
        executor.execute(() -> sendMoViaHttp(from, text, timestamp));
    }

    private boolean sendMoViaHttp(String from, String text, long timestamp) {
        try {
            String auth = android.util.Base64.encodeToString(
                    (username + ":" + password).getBytes("UTF-8"),
                    android.util.Base64.NO_WRAP);

            java.net.URL url = new java.net.URL(serverUrl + "/api/gateway/mo-sms");
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Basic " + auth);
            conn.setRequestProperty("X-API-Key", apiKey);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);

            JSONObject payload = new JSONObject();
            payload.put("from", from);
            payload.put("text", text);
            payload.put("timestamp", timestamp);

            java.io.OutputStream os = conn.getOutputStream();
            os.write(payload.toString().getBytes("UTF-8"));
            os.close();

            int status = conn.getResponseCode();
            if (status == 200) {
                Log.i(TAG, "MO forwarded via HTTP: " + from);
                // Mark as sent in offline queue
                if (offlineQueue != null) {
                    offlineQueue.markSentBySource(from, text, timestamp);
                }
                return true;
            }
            Log.w(TAG, "MO HTTP forward failed: HTTP " + status);
            return false;
        } catch (Exception e) {
            Log.w(TAG, "MO HTTP forward failed (queued): " + e.getMessage());
            return false;
        }
    }

    private void reportDlrViaSmpp(String msgId, String status, String errorCode) {
        executor.execute(() -> sendDlrViaHttp(msgId, status, errorCode));
    }

    private boolean sendDlrViaHttp(String msgId, String dlrStatus, String errorCode) {
        try {
            String auth = android.util.Base64.encodeToString(
                    (username + ":" + password).getBytes("UTF-8"),
                    android.util.Base64.NO_WRAP);

            java.net.URL url = new java.net.URL(serverUrl + "/api/gateway/mt-dlr");
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Basic " + auth);
            conn.setRequestProperty("X-API-Key", apiKey);
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

            int status = conn.getResponseCode();
            if (status == 200) {
                Log.i(TAG, "DLR reported: " + msgId + " -> " + dlrStatus);
                return true;
            }
            Log.w(TAG, "DLR HTTP report failed: HTTP " + status + " (will retry: " + msgId + ")");
            return false;
        } catch (Exception e) {
            Log.w(TAG, "DLR HTTP report failed (will retry): " + e.getMessage());
            return false;
        }
    }

    // ============================================================
    // REAL DLR — delivery broadcast receiver + reaper
    // ============================================================

    /**
     * Receives the pending-intent broadcasts fired by SmsManager when a part
     * is SENT (radio ack) and DELIVERED (handset confirmation). The first
     * DELIVERED part for a message triggers a single DELIVRD DLR to the
     * server; a failed sent/delivery triggers FAILED with the radio error.
     */
    private void registerDlrReceiver() {
        if (dlrReceiverRegistered) return;
        dlrReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                String msgId = intent.getStringExtra(EXTRA_MSG_ID);
                int part = intent.getIntExtra(EXTRA_PART, 0);
                int parts = intent.getIntExtra(EXTRA_PARTS, 1);
                String dest = intent.getStringExtra(EXTRA_DEST);
                boolean delivered = ACTION_SMS_DELIVERED.equals(intent.getAction());
                int rc = getResultCode();

                if (msgId == null) return;

                // SENT broadcast: only fail fast on permanent radio errors.
                // RESULT_ERROR_GENERIC_FAILURE (1) / RADIO_OFF (2) / NO_SERVICE (3)
                if (!delivered && rc != android.app.Activity.RESULT_OK) {
                    if (rc == android.telephony.SmsManager.RESULT_ERROR_GENERIC_FAILURE
                            || rc == android.telephony.SmsManager.RESULT_ERROR_RADIO_OFF
                            || rc == android.telephony.SmsManager.RESULT_ERROR_NO_SERVICE) {
                        Log.w(TAG, "SMS part FAILED (sent rc=" + rc + ") msg=" + msgId);
                        if (dlrReported.add(msgId)) {
                            context.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE)
                                    .edit().remove("inflight_" + msgId).apply();
                            if (offlineQueue != null) {
                                offlineQueue.enqueueMtDlr(msgId, "FAILED:" + rc, System.currentTimeMillis(), "FAILED");
                            } else {
                                sendDlrViaHttp(msgId, "FAILED", String.valueOf(rc));
                            }
                        }
                    }
                    return; // sent-ack OK — wait for the delivered broadcast
                }

                if (delivered && rc == android.app.Activity.RESULT_OK) {
                    Log.i(TAG, "SMS part DELIVERED (" + (part + 1) + "/" + parts + ") msg=" + msgId);
                    // Report DELIVRD once per message (first part wins)
                    if (dlrReported.add(msgId)) {
                        // Clear in-flight marker — final status known
                        context.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE)
                                .edit().remove("inflight_" + msgId).apply();
                        if (offlineQueue != null) {
                            offlineQueue.enqueueMtDlr(msgId, "DELIVRD:000", System.currentTimeMillis(), "DELIVRD");
                        } else {
                            sendDlrViaHttp(msgId, "DELIVRD", "000");
                        }
                    }
                } else if (delivered) {
                    Log.w(TAG, "SMS part NOT delivered (rc=" + rc + ") msg=" + msgId);
                    if (dlrReported.add(msgId)) {
                        context.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE)
                                .edit().remove("inflight_" + msgId).apply();
                        if (offlineQueue != null) {
                            offlineQueue.enqueueMtDlr(msgId, "UNDELIV:" + rc, System.currentTimeMillis(), "UNDELIV");
                        } else {
                            sendDlrViaHttp(msgId, "UNDELIV", String.valueOf(rc));
                        }
                    }
                }
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_SMS_SENT);
        filter.addAction(ACTION_SMS_DELIVERED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            context.registerReceiver(dlrReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(dlrReceiver, filter);
        }
        dlrReceiverRegistered = true;
        Log.i(TAG, "DLR delivery receiver registered");
    }

    private void unregisterDlrReceiver() {
        if (dlrReceiver != null && dlrReceiverRegistered) {
            try { context.unregisterReceiver(dlrReceiver); } catch (Exception ignored) {}
        }
        dlrReceiverRegistered = false;
    }

    /**
     * Reaper pass: dispatched MT SMS whose delivery broadcast never arrived
     * within the grace window (process death / reboot) are reported UNDELIV so
     * the server never waits forever (no message stuck PENDING_ANDROID).
     * In-flight msgIds are persisted in SharedPreferences — survives restarts.
     */
    private void startDlrReaper() {
        if (dlrReaperHandler == null) {
            dlrReaperHandler = new Handler(Looper.getMainLooper());
        }
        dlrReaperHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                executor.execute(() -> {
                    try {
                        android.content.SharedPreferences prefs = context.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE);
                        java.util.Map<String, ?> inflight = prefs.getAll();
                        long now = System.currentTimeMillis();
                        for (java.util.Map.Entry<String, ?> e : inflight.entrySet()) {
                            String key = e.getKey();
                            if (!key.startsWith("inflight_")) continue;
                            long dispatchedAt = Long.parseLong(String.valueOf(e.getValue()));
                            if (now - dispatchedAt > DLR_REAP_GRACE_MS) {
                                String msgId = key.substring("inflight_".length());
                                if (dlrReported.add(msgId)) {
                                    Log.w(TAG, "Reaping in-flight MT " + msgId + " as UNDELIV (no broadcast in " + DLR_REAP_GRACE_MS / 1000 + "s)");
                                    sendDlrViaHttp(msgId, "UNDELIV", "900");
                                }
                                prefs.edit().remove(key).apply();
                            }
                        }
                    } catch (Exception ex) {
                        Log.w(TAG, "DLR reaper pass failed: " + ex.getMessage());
                    }
                });
                dlrReaperHandler.postDelayed(this, FLUSH_REAP_MS);
            }
        }, FLUSH_REAP_MS);
    }

    private void registerSmsReceiver() {
        if (smsReceiverRegistered) return;

        smsReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                if (Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) {
                    android.os.Bundle bundle = intent.getExtras();
                    if (bundle != null) {
                        Object[] pdus = (Object[]) bundle.get("pdus");
                        if (pdus != null) {
                            for (Object pdu : pdus) {
                                SmsMessage sms = SmsMessage.createFromPdu((byte[]) pdu,
                                        bundle.getString("format"));
                                String from = sms.getDisplayOriginatingAddress();
                                String body = sms.getDisplayMessageBody();
                                long timestamp = sms.getTimestampMillis();
                                Log.i(TAG, "MO SMS received from " + from);
                                enqueueMoToDb(from, body, timestamp);
                            }
                        }
                    }
                }
            }
        };

        IntentFilter filter = new IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            context.registerReceiver(smsReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(smsReceiver, filter);
        }
        smsReceiverRegistered = true;
        Log.i(TAG, "SMS receiver registered");
    }

    private void unregisterSmsReceiver() {
        if (smsReceiver != null && smsReceiverRegistered) {
            try {
                context.unregisterReceiver(smsReceiver);
            } catch (Exception e) {
                // Already unregistered
            }
        }
        smsReceiverRegistered = false;
    }

    // ============================================================
    // HEARTBEAT / QUEUE FLUSHER LIFECYCLE
    // ============================================================

    private void startHeartbeat() {
        if (heartbeatHandler == null) {
            heartbeatHandler = new Handler(Looper.getMainLooper());
        }
        if (heartbeatRunnable != null) {
            heartbeatHandler.removeCallbacks(heartbeatRunnable);
        }
        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                doHeartbeat();
                heartbeatHandler.postDelayed(this, HEARTBEAT_INTERVAL_MS);
            }
        };
        heartbeatHandler.post(heartbeatRunnable);
        Log.i(TAG, "Heartbeat started (every " + HEARTBEAT_INTERVAL_MS / 1000 + "s)");
    }

    private void startQueueFlusher() {
        if (flushHandler == null) {
            flushHandler = new Handler(Looper.getMainLooper());
        }
        if (flushRunnable != null) {
            flushHandler.removeCallbacks(flushRunnable);
        }
        flushRunnable = new Runnable() {
            @Override
            public void run() {
                executor.execute(() -> flushQueue());
                flushHandler.postDelayed(this, FLUSH_INTERVAL_MS);
            }
        };
        flushHandler.postDelayed(flushRunnable, FLUSH_INTERVAL_MS);
        Log.i(TAG, "Queue flusher started (every " + FLUSH_INTERVAL_MS / 1000 + "s)");
    }

    private int flushQueue() {
        if (offlineQueue == null) return 0;
        int flushed = 0;

        List<OfflineMessage> pending = offlineQueue.getPendingBatch(20);
        for (OfflineMessage msg : pending) {
            boolean ok = false;
            try {
                if ("mo".equals(msg.direction)) {
                    ok = sendMoViaHttp(msg.fromAddress, msg.messageText, msg.receivedAt);
                } else if ("dlr".equals(msg.direction)) {
                    String[] parts = msg.messageText.split(":", 2);
                    ok = sendDlrViaHttp(msg.fromAddress,
                            parts.length > 1 ? parts[0] : "DELIVRD",
                            parts.length > 1 ? parts[1] : "000");
                }
            } catch (Exception e) {
                Log.w(TAG, "Flush attempt error for #" + msg.id + ": " + e.getMessage());
            }
            // Only mark sent on confirmed HTTP 200; otherwise count the attempt
            // and leave the row pending — retried on the next flush/offline period.
            if (ok) {
                offlineQueue.markSent(msg.id);
                flushed++;
            } else {
                offlineQueue.recordAttempt(msg.id);
            }
        }
        return flushed;
    }

    // ============================================================
    // UI NOTIFICATIONS
    // ============================================================

    private void notifyQueueChanged(int pending) {
        try {
            JSObject msg = new JSObject();
            msg.put("pending", pending);
            notifyListeners("queueChanged", msg);
        } catch (Exception e) {
            Log.w(TAG, "Failed to notify queue change: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        unregisterSmsReceiver();
        unregisterDlrReceiver();
        if (heartbeatHandler != null && heartbeatRunnable != null) {
            heartbeatHandler.removeCallbacks(heartbeatRunnable);
        }
        if (flushHandler != null && flushRunnable != null) {
            flushHandler.removeCallbacks(flushRunnable);
        }
        if (smppClient != null) {
            smppClient.shutdown();
        }
        if (executor != null) {
            executor.shutdown();
        }
        Log.i(TAG, "SmsGatewayPlugin destroyed");
    }
}
