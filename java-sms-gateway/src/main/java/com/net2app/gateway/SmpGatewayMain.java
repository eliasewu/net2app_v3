package com.net2app.gateway;

import com.net2app.gateway.smpp.SmppServer;
import com.net2app.gateway.smpp.SmppClientManager;
import com.net2app.gateway.rest.RestBridge;
import com.net2app.gateway.db.Database;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * NET2APP SMS Gateway — Java 21 SMPP Engine
 *
 * Modes:
 *   - SERVER: Listens for SMPP client connections (ESMEs from the platform).
 *     GSM modems/devices without public IP pair with this server using
 *     server IP, port, username, and password.
 *   - CLIENT: Connects to external SMSCs (suppliers) to deliver SMS.
 *
 * Architecture:
 *   Java 21 SMPP ↔ PostgreSQL (shared with Node.js server.cjs)
 *   Node.js handles REST API, web UI, HTTP clients
 *   Java handles all SMPP protocol (ESME + SMSC sides)
 */
public class SmpGatewayMain {
    private static final Logger log = LoggerFactory.getLogger(SmpGatewayMain.class);

    public static void main(String[] args) {
        log.info("=== NET2APP SMS Gateway v1.0.0 (Java 21) ===");

        // 1. Initialize database connection pool
        Database.init();

        // 2. Start SMPP Server (accepts client/ESME connections on port 2775)
        SmppServer smppServer = new SmppServer(2775);
        smppServer.start();
        log.info("SMPP Server started on port 2775 (server mode)");

        // 3. Start SMPP Client Manager (connects to external SMSCs from DB config)
        SmppClientManager clientManager = new SmppClientManager();
        clientManager.startAll();
        log.info("SMPP Client Manager started");

        // 4. Start REST Bridge (exposes Java SMPP status/mgmt to Node.js)
        RestBridge restBridge = new RestBridge(9091);
        restBridge.start();
        log.info("REST Bridge started on port 9091");

        // 5. Register shutdown hook
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            log.info("Shutting down...");
            smppServer.stop();
            clientManager.stopAll();
            restBridge.stop();
            Database.shutdown();
            log.info("Shutdown complete");
        }));

        log.info("All services started. Ready to process SMPP traffic.");
    }
}
