package com.net2app.gateway;

import android.content.Intent;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // SmsGatewayPlugin is auto-registered via @CapacitorPlugin annotation
        registerPlugin(SmsGatewayPlugin.class);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        // Route the system permission result to the gateway plugin so the
        // pending JS call resolves — without this the app hangs on "denied".
        SmsGatewayPlugin plugin = null;
        PluginHandle handle = bridge.getPlugin("SmsGateway");
        if (handle != null) {
            plugin = (SmsGatewayPlugin) handle.getInstance();
        }
        if (plugin != null) {
            plugin.handleRequestPermissionsResult(requestCode, permissions, grantResults);
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }
}
