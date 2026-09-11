package com.net2app.gateway.rest;

import com.cloudhopper.commons.util.windowing.WindowFuture;
import com.cloudhopper.smpp.SmppSession;
import com.cloudhopper.smpp.pdu.PduRequest;
import com.cloudhopper.smpp.pdu.PduResponse;
import com.cloudhopper.smpp.pdu.SubmitSm;
import com.cloudhopper.smpp.pdu.SubmitSmResp;
import com.cloudhopper.smpp.type.Address;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.net2app.gateway.db.Database;
import com.net2app.gateway.smpp.DlrPusher;
import com.net2app.gateway.smpp.SmppClientManager;
import com.net2app.gateway.smpp.SmppServer;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.util.Map;

/**
 * REST Bridge — exposes Java SMPP gateway status and management
 * to the Node.js backend on port 9090.
 *
 * This allows server.cjs to:
 *   - Query SMPP bind status
 *   - Trigger reconnects
 *   - Get session statistics
 *
 * Endpoints:
 *   GET  /health          — Gateway health check
 *   GET  /sessions        — List all active SMPP sessions
 *   POST /reconnect/:id   — Force reconnect a supplier
 *   GET  /stats           — Connection statistics
 */
public class RestBridge {
    private static final Logger log = LoggerFactory.getLogger(RestBridge.class);
    private static final ObjectMapper mapper = new ObjectMapper();

    private final int port;
    private final SmppServer smppServer;
    private HttpServer server;

    public RestBridge(int port, SmppServer smppServer) {
        this.port = port;
        this.smppServer = smppServer;
    }

    public void start() {
        try {
            server = HttpServer.create(new InetSocketAddress(port), 0);

            server.createContext("/health", new HealthHandler());
            server.createContext("/sessions", new SessionsHandler());
            server.createContext("/live-sessions", new LiveSessionsHandler());
            server.createContext("/reconnect/", new ReconnectHandler());
            server.createContext("/stats", new StatsHandler());
            server.createContext("/deliver", new DeliverHandler());
            server.createContext("/dlr/push", new DlrPushHandler());
            server.createContext("/session/drop", new SessionDropHandler());

            server.setExecutor(java.util.concurrent.Executors.newFixedThreadPool(4));
            server.start();
            log.info("REST Bridge listening on port {}", port);
        } catch (IOException e) {
            log.error("Failed to start REST bridge: {}", e.getMessage());
        }
    }

    public void stop() {
        if (server != null) {
            server.stop(1);
            log.info("REST Bridge stopped");
        }
    }

    /**
     * Health check — confirms Java gateway is running.
     */
    private static class HealthHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            Map<String, Object> response = Map.of(
                "status", "ok",
                "service", "net2app-sms-gateway",
                "version", "1.0.0",
                "java", System.getProperty("java.version"),
                "timestamp", System.currentTimeMillis()
            );
            sendJson(exchange, 200, response);
        }
    }

    /**
     * Live session counts per entity — "client:1" -> 3 means client #1 has 3
     * simultaneous bound connections (several ESME boxes sharing one system_id).
     * Returns [{entity_type, entity_id, count}, ...].
     */
    private class LiveSessionsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            var counts = smppServer.getLiveSessionCounts();
            var sessions = counts.entrySet().stream()
                .map(entry -> {
                    String[] parts = entry.getKey().split(":", 2);
                    return Map.of(
                        "entity_type", parts[0],
                        "entity_id", Integer.parseInt(parts[1]),
                        "count", entry.getValue()
                    );
                })
                .toList();
            sendJson(exchange, 200, Map.of("count", sessions.size(), "sessions", sessions));
        }
    }

    /**
     * List all active SMPP sessions (both server-side clients and supplier connections).
     */
    private static class SessionsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            var clientManager = new SmppClientManager(); // Use singleton in production
            var activeSessions = clientManager.getActiveSessions();

            var sessions = activeSessions.entrySet().stream()
                .map(entry -> Map.of(
                    "supplier_id", entry.getKey(),
                    "bound", entry.getValue().isBound(),
                    "state", entry.getValue().isBound() ? "BOUND" : (entry.getValue().isClosed() ? "CLOSED" : "OPEN")
                ))
                .toList();

            Map<String, Object> response = Map.of(
                "count", sessions.size(),
                "sessions", sessions
            );
            sendJson(exchange, 200, response);
        }
    }

    /**
     * Force reconnect a specific supplier.
     * POST /reconnect/{supplierId}
     */
    private static class ReconnectHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, Map.of("error", "Method not allowed"));
                return;
            }

            String path = exchange.getRequestURI().getPath();
            String[] parts = path.split("/");
            if (parts.length < 3) {
                sendJson(exchange, 400, Map.of("error", "Missing supplier ID"));
                return;
            }
            String supplierId = parts[parts.length - 1];

            try {
                var clientManager = new SmppClientManager();
                // Disconnect and let auto-reconnect handle it
                clientManager.disconnect(supplierId);
                sendJson(exchange, 200, Map.of(
                    "status", "ok",
                    "message", "Supplier " + supplierId + " disconnected. Auto-reconnect pending."
                ));
            } catch (Exception e) {
                sendJson(exchange, 500, Map.of("error", e.getMessage()));
            }
        }
    }

    /**
     * Connection statistics.
     */
    private static class StatsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            Map<String, Object> response = Map.of(
                "uptime_ms", System.currentTimeMillis(),
                "memory_used_mb", (Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()) / (1024 * 1024),
                "memory_max_mb", Runtime.getRuntime().maxMemory() / (1024 * 1024),
                "threads", Thread.activeCount()
            );
            sendJson(exchange, 200, response);
        }
    }

    /**
     * Deliver submit_sm through an existing inbound SMPP session.
     * POST /deliver
     * Body: { "supplier_id": 65, "source_addr": "1234", "dest_addr": "2519...", "message": "OTP 123456" }
     */
    private class DeliverHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, Map.of("error", "Method not allowed"));
                return;
            }

            try {
                // Read request body
                InputStream is = exchange.getRequestBody();
                String body = new String(is.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
                @SuppressWarnings("unchecked")
                Map<String, Object> req = mapper.readValue(body, Map.class);

                int supplierId = req.get("supplier_id") instanceof Number
                    ? ((Number) req.get("supplier_id")).intValue()
                    : Integer.parseInt(String.valueOf(req.get("supplier_id")));
                String sourceAddr = String.valueOf(req.getOrDefault("source_addr", ""));
                String destAddr = String.valueOf(req.getOrDefault("dest_addr", ""));
                String message = String.valueOf(req.getOrDefault("message", ""));
                String ourMessageId = String.valueOf(req.getOrDefault("our_message_id", ""));

                if (destAddr.isEmpty() || message.isEmpty()) {
                    sendJson(exchange, 400, Map.of("error", "Missing dest_addr or message"));
                    return;
                }

                // Look up supplier's smpp_username to find the session
                Database.SupplierLookup supplier = Database.lookupSupplierById(supplierId);
                if (supplier == null) {
                    sendJson(exchange, 404, Map.of("error", "Supplier not found: " + supplierId));
                    return;
                }

                // Find active session by systemId (smpp_username)
                SmppSession session = smppServer.getSession(supplier.smppUsername);
                if (session == null || !session.isBound()) {
                    sendJson(exchange, 503, Map.of(
                        "error", "No active session for supplier " + supplier.supplierCode,
                        "supplier_id", supplierId,
                        "system_id", supplier.smppUsername
                    ));
                    return;
                }

                // Build and send submit_sm
                SubmitSm sm = new SubmitSm();
                sm.setSourceAddress(new Address((byte) 0x01, (byte) 0x01, sourceAddr));
                sm.setDestAddress(new Address((byte) 0x01, (byte) 0x01, destAddr));
                sm.setShortMessage(message.getBytes("UTF-8"));
                sm.setRegisteredDelivery((byte) 1);
                sm.setDataCoding((byte) 0);

                log.info("REST DELIVER: {} -> {} ({} chars) via {} session",
                    sourceAddr, destAddr, message.length(), supplier.supplierCode);

                // Send synchronously to capture the submit_sm_resp message_id.
                // This is the ID test192 assigns — we need it to match DLRs later.
                String gatewayMsgId = null;
                try {
                    WindowFuture<Integer, PduRequest, PduResponse> future =
                        session.sendRequestPdu(sm, 10000, false);
                    if (future != null && future.await()) {
                        PduResponse resp = future.getResponse();
                        if (resp instanceof SubmitSmResp) {
                            gatewayMsgId = ((SubmitSmResp) resp).getMessageId();
                            log.info("REST DELIVER: gateway msgId={} for our msgId={}", gatewayMsgId, ourMessageId);
                        }
                    }
                } catch (Exception e) {
                    log.warn("REST DELIVER: failed to get submit_sm_resp: {}", e.getMessage());
                }

                // Store the gateway's message_id so DLR matching works
                if (gatewayMsgId != null && !ourMessageId.isEmpty()) {
                    Database.updateSmppMessageId(ourMessageId, gatewayMsgId);
                }

                sendJson(exchange, 200, Map.of(
                    "status", "ok",
                    "supplier_code", supplier.supplierCode,
                    "system_id", supplier.smppUsername,
                    "dest_addr", destAddr,
                    "gateway_message_id", gatewayMsgId != null ? gatewayMsgId : ""
                ));
            } catch (Exception e) {
                log.error("Deliver handler error: {}", e.getMessage());
                sendJson(exchange, 500, Map.of("error", e.getMessage()));
            }
        }
    }

    /**
     * Push a supplier DLR immediately to the external SMPP client that
     * submitted the message.
     *
     * POST /dlr/push
     * Body: { "message_id": "...", "entity_type": "client", "entity_id": 3,
     *         "client_code": "ABC", "destination": "2519...",
     *         "sender_id": "NET2APP", "status": "DELIVRD",
     *         "dlr_receipt": "id:... stat:DELIVRD", "submit_time": "..." }
     *
     * Node.js calls this the instant a supplier deliver_sm arrives, so the
     * external client receives the DLR immediately instead of waiting up to
     * 5s for the dlr_outbox poller. If the client isn't connected, the row
     * stays in dlr_outbox and the 5s poller retries.
     */
    private class DlrPushHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, Map.of("error", "Method not allowed"));
                return;
            }

            try {
                InputStream is = exchange.getRequestBody();
                String body = new String(is.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
                @SuppressWarnings("unchecked")
                Map<String, Object> req = mapper.readValue(body, Map.class);

                String messageId = String.valueOf(req.getOrDefault("message_id", ""));
                if (messageId.isEmpty()) {
                    sendJson(exchange, 400, Map.of("error", "Missing message_id"));
                    return;
                }

                // Try to load the pending row first (Node inserts it before calling),
                // so we get the real dlr_outbox id for marking it pushed.
                Database.PendingDlr dlr = Database.getPendingDlrByMessageId(messageId);
                if (dlr == null) {
                    // Row not found (e.g. internal DLR path) — build from the request
                    // payload so the push still works. id=0 makes markDlrPushed a no-op.
                    dlr = new Database.PendingDlr();
                    dlr.messageId = messageId;
                    dlr.entityType = String.valueOf(req.getOrDefault("entity_type", "client"));
                    dlr.entityId = req.get("entity_id") instanceof Number
                        ? ((Number) req.get("entity_id")).intValue()
                        : Integer.parseInt(String.valueOf(req.getOrDefault("entity_id", "0")));
                    dlr.clientId = dlr.entityType.equals("client") ? dlr.entityId : 0;
                    dlr.clientCode = String.valueOf(req.getOrDefault("client_code", ""));
                    dlr.destination = String.valueOf(req.getOrDefault("destination", ""));
                    dlr.senderId = String.valueOf(req.getOrDefault("sender_id", ""));
                    dlr.status = String.valueOf(req.getOrDefault("status", "DELIVRD"));
                    dlr.dlrReceipt = String.valueOf(req.getOrDefault("dlr_receipt", ""));
                    try {
                        if (req.get("submit_time") != null) {
                            dlr.submitTime = java.sql.Timestamp.valueOf(
                                String.valueOf(req.get("submit_time")).replace("T", " ").substring(0, 19));
                        }
                    } catch (Exception ignore) {
                        // keep null submitTime
                    }
                }

                boolean pushed = DlrPusher.pushDlr(smppServer, dlr);
                if (pushed) {
                    sendJson(exchange, 200, Map.of(
                        "status", "ok",
                        "message_id", messageId,
                        "delivered", true
                    ));
                } else {
                    sendJson(exchange, 202, Map.of(
                        "status", "queued",
                        "message_id", messageId,
                        "delivered", false,
                        "message", "Client not connected — queued for 5s poller retry"
                    ));
                }
            } catch (Exception e) {
                log.error("DLR push handler error: {}", e.getMessage());
                sendJson(exchange, 500, Map.of("error", e.getMessage()));
            }
        }
    }

    /**
     * Drop an active SMPP session (Connect/Disconnect buttons in the UI).
     *
     * POST /session/drop
     * Body: { "entity_type": "client" | "supplier", "entity_id": 3 }
     *   OR  { "system_id": "SomeUser" }
     *
     * Closes the TCP/SMPP session for the entity. The Java gateway's
     * sessionDestroyed handler records the unbind in smpp_sessions + bind_history.
     */
    private class SessionDropHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, Map.of("error", "Method not allowed"));
                return;
            }
            try {
                InputStream is = exchange.getRequestBody();
                String body = new String(is.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
                @SuppressWarnings("unchecked")
                Map<String, Object> req = mapper.readValue(body, Map.class);

                boolean dropped;
                String detail;

                if (req.containsKey("system_id")) {
                    String systemId = String.valueOf(req.get("system_id"));
                    dropped = smppServer.dropSession(systemId);
                    detail = "system_id=" + systemId;
                } else {
                    String entityType = String.valueOf(req.getOrDefault("entity_type", "client"));
                    int entityId = req.get("entity_id") instanceof Number
                        ? ((Number) req.get("entity_id")).intValue()
                        : Integer.parseInt(String.valueOf(req.getOrDefault("entity_id", "0")));
                    dropped = smppServer.dropSessionByEntity(entityType, entityId);
                    detail = entityType + ".id=" + entityId;
                }

                sendJson(exchange, 200, Map.of(
                    "status", dropped ? "dropped" : "not_found",
                    "dropped", dropped,
                    "detail", detail
                ));
            } catch (Exception e) {
                log.error("Session drop handler error: {}", e.getMessage());
                sendJson(exchange, 500, Map.of("error", e.getMessage()));
            }
        }
    }

    private static void sendJson(HttpExchange exchange, int statusCode, Object body) throws IOException {
        String json = mapper.writeValueAsString(body);
        byte[] bytes = json.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.sendResponseHeaders(statusCode, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
