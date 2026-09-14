package com.net2app.gateway;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * Restarts the foreground gateway service after a device reboot so the
 * phone reconnects to the server without anyone opening the app.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

        SharedPreferences prefs = context.getSharedPreferences("sms_gateway", Context.MODE_PRIVATE);
        String url = prefs.getString("server_url", "");
        String user = prefs.getString("username", "");
        if (url.isEmpty() || user.isEmpty()) return; // never configured

        Intent svc = new Intent(context, GatewayService.class);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(svc);
        } else {
            context.startService(svc);
        }
    }
}
