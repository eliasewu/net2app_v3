package com.net2app.gateway.rest;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.net2app.gateway.smpp.SmppClientManager;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
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
    private HttpServer server;

    public RestBridge(int port) {
        this.port = port;
    }

    public void start() {
        try {
            server = HttpServer.create(new InetSocketAddress(port), 0);

            server.createContext("/health", new HealthHandler());
            server.createContext("/sessions", new SessionsHandler());
            server.createContext("/reconnect/", new ReconnectHandler());
            server.createContext("/stats", new StatsHandler());

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
