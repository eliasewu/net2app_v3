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
        // MULTI-NODE engine handles its own "never configured" case (idle),
        // the foreground service, heartbeats to ALL nodes and receivers.
        GatewayCore.start(context);
    }
}
