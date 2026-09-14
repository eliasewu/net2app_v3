package com.net2app.gateway;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/**
 * Foreground service that keeps the gateway process alive so the heartbeat,
 * offline queue flusher and SMS receivers keep running while the app is in
 * the background. Shows a low-priority persistent notification as required
 * by Android 8+ (and a foregroundServiceType on Android 14+).
 */
public class GatewayService extends Service {
    private static final String CHANNEL_ID = "net2app_gateway";
    private static final int NOTIFICATION_ID = 1001;

    /** Lets getStatus report the real service state to the UI. */
    public static volatile boolean running = false;

    @Override
    public void onCreate() {
        super.onCreate();
        startForegroundWithNotification();
        running = true;
    }

    private void startForegroundWithNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID,
                    "Gateway Status", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps the SMS gateway connected");
            nm.createNotificationChannel(ch);
            b = new Notification.Builder(this, CHANNEL_ID);
        } else {
            b = new Notification.Builder(this);
        }
        b.setContentTitle("Net2appPro Gateway")
                .setContentText("SMS gateway is running in the background")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true);
        startForeground(NOTIFICATION_ID, b.build());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Re-assert foreground state on every restart (START_STICKY redelivery)
        startForegroundWithNotification();
        running = true;
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
