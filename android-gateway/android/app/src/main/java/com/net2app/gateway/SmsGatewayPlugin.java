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

    // HTTP heartbeat config
    private String serverUrl = "";
    private String username = "";
    private String password = "";
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
                // Save call for permission result
                bridge.saveCall(call);
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
                registerSmsReceiver();
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
                                sendSmsViaAndroid(dest, msg);
                                // Report DLR back to server for each MT delivered
                                sendDlrViaHttp(msgId, "DELIVRD", "000");
                            }
                        }
                    }
                } else {
                    Log.w(TAG, "Heartbeat failed: HTTP " + status);
                    isRegistered = false;
                    // Try re-register
                    registerWithServer();
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
        try {
            SmsManager smsManager = SmsManager.getDefault();
            ArrayList<String> parts = smsManager.divideMessage(message);

            ArrayList<android.app.PendingIntent> sentIntents = new ArrayList<>();
            ArrayList<android.app.PendingIntent> deliveredIntents = new ArrayList<>();

            for (int i = 0; i < parts.size(); i++) {
                Intent sentIntent = new Intent("SMS_SENT_" + destination + "_" + i);
                Intent deliveredIntent = new Intent("SMS_DELIVERED_" + destination + "_" + i);

                sentIntents.add(android.app.PendingIntent.getBroadcast(context, 0,
                        sentIntent, android.app.PendingIntent.FLAG_IMMUTABLE));
                deliveredIntents.add(android.app.PendingIntent.getBroadcast(context, 0,
                        deliveredIntent, android.app.PendingIntent.FLAG_IMMUTABLE));
            }

            smsManager.sendMultipartTextMessage(destination, null, parts,
                    sentIntents, deliveredIntents);
            Log.i(TAG, "MT SMS sent to " + destination + " (" + parts.size() + " parts)");
        } catch (Exception e) {
            Log.e(TAG, "Failed to send MT SMS: " + e.getMessage());
            if (offlineQueue != null) {
                offlineQueue.enqueueMtDlr(destination, message, System.currentTimeMillis(), "FAILED");
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

    private void sendMoViaHttp(String from, String text, long timestamp) {
        try {
            String auth = android.util.Base64.encodeToString(
                    (username + ":" + password).getBytes("UTF-8"),
                    android.util.Base64.NO_WRAP);

            java.net.URL url = new java.net.URL(serverUrl + "/api/gateway/mo-sms");
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Basic " + auth);
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
            }
        } catch (Exception e) {
            Log.w(TAG, "MO HTTP forward failed (queued): " + e.getMessage());
        }
    }

    private void reportDlrViaSmpp(String msgId, String status, String errorCode) {
        executor.execute(() -> sendDlrViaHttp(msgId, status, errorCode));
    }

    private void sendDlrViaHttp(String msgId, String dlrStatus, String errorCode) {
        try {
            String auth = android.util.Base64.encodeToString(
                    (username + ":" + password).getBytes("UTF-8"),
                    android.util.Base64.NO_WRAP);

            java.net.URL url = new java.net.URL(serverUrl + "/api/gateway/mt-dlr");
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Basic " + auth);
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
            }
        } catch (Exception e) {
            Log.w(TAG, "DLR HTTP report failed (queued): " + e.getMessage());
            if (offlineQueue != null) {
                offlineQueue.enqueueMtDlr(msgId, dlrStatus + ":" + errorCode,
                        System.currentTimeMillis(), dlrStatus);
            }
        }
    }

    // ============================================================
    // SMS RECEIVER (MO detection)
    // ============================================================

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
            try {
                if ("mo".equals(msg.direction)) {
                    sendMoViaHttp(msg.fromAddress, msg.messageText, msg.receivedAt);
                } else if ("dlr".equals(msg.direction)) {
                    String[] parts = msg.messageText.split(":", 2);
                    sendDlrViaHttp(msg.fromAddress,
                            parts.length > 1 ? parts[0] : "DELIVRD",
                            parts.length > 1 ? parts[1] : "000");
                }
                offlineQueue.markSent(msg.id);
                flushed++;
            } catch (Exception e) {
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
