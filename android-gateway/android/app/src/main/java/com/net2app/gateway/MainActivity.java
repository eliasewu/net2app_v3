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
        // MULTI-NODE: start the native gateway engine directly — independent
        // of the WebView/JS bridge, so the phone connects to ALL paired hub
        // nodes even if JS never calls the plugin.
        try {
            GatewayCore.start(this);
        } catch (Exception e) {
            android.util.Log.e("GatewayCore", "start failed: " + e.getMessage());
        }
        // Plain WebView JS bridge — reliable fallback that bypasses the
        // Capacitor plugin layer (window.Net2appNative.* from JS).
        try {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().addJavascriptInterface(new ConfigBridge(this), "Net2appNative");
            }
        } catch (Exception e) {
            android.util.Log.e("ConfigBridge", "register failed: " + e.getMessage());
        }
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
