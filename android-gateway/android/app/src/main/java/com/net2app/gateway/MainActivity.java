package com.net2app.gateway;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // SmsGatewayPlugin is auto-registered via @CapacitorPlugin annotation
        registerPlugin(SmsGatewayPlugin.class);
    }
}
