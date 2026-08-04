package com.net2app.gateway.db;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.*;
import java.util.ArrayList;
import java.util.List;

/**
 * Database access layer shared with Node.js server.cjs.
 * Uses HikariCP connection pool for high-performance SMPP operations.
 *
 * DB credentials match server.cjs configuration.
 */
public class Database {
    private static final Logger log = LoggerFactory.getLogger(Database.class);

    private static HikariDataSource dataSource;

    public static void init() {
        if (dataSource != null && !dataSource.isClosed()) return;

        String host = System.getenv().getOrDefault("DB_HOST", "localhost");
        String port = System.getenv().getOrDefault("DB_PORT", "5432");
        String dbName = System.getenv().getOrDefault("DB_NAME", "sms_platform");
        String user = System.getenv().getOrDefault("DB_USER", "sms_user");
        String pass = System.getenv().getOrDefault("DB_PASS", "Ariya@2024Net2App");

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://" + host + ":" + port + "/" + dbName);
        config.setUsername(user);
        config.setPassword(pass);
        config.setMaximumPoolSize(10);
        config.setMinimumIdle(2);
        config.setConnectionTimeout(10000);
        config.setIdleTimeout(600000);
        config.setMaxLifetime(1800000);

        dataSource = new HikariDataSource(config);
        log.info("Database connection pool initialized ({}:{}/{})", host, port, dbName);
    }

    public static Connection getConnection() throws SQLException {
        return dataSource.getConnection();
    }

    public static void shutdown() {
        if (dataSource != null && !dataSource.isClosed()) {
            dataSource.close();
            log.info("Database connection pool closed");
        }
    }

    // ==================== Authentication ====================

    public static boolean authenticateClient(String systemId, String password) {
        String sql = "SELECT 1 FROM clients WHERE smpp_username = ? AND smpp_password = ? AND status = 'active' AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, systemId);
            ps.setString(2, password);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        } catch (SQLException e) {
            log.error("Client auth error: {}", e.getMessage());
            return false;
        }
    }

    public static boolean authenticateSupplier(String systemId, String password) {
        String sql = "SELECT 1 FROM suppliers WHERE smpp_username = ? AND smpp_password = ? AND is_inbound = true AND status = 'active' AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, systemId);
            ps.setString(2, password);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        } catch (SQLException e) {
            log.error("Supplier auth error: {}", e.getMessage());
            return false;
        }
    }

    // ==================== SMS Operations ====================

    public static String insertSmsLog(String clientSystemId, String sourceAddr, String destAddr,
                                       String message, int registeredDelivery, int dataCoding, int esmClass) {
        String messageId = "SMPP" + System.currentTimeMillis();
        String sql = """
            INSERT INTO sms_logs (message_id, client_code, sender_id, destination, message,
                                  registered_delivery, data_coding, esm_class,
                                  status, submit_time, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', NOW(), 'smpp')
            """;

        // Look up both client and supplier by smpp_username.
        // Clients = ESMEs sending outbound SMS.
        // Suppliers = inbound GSM gateways submitting SMS TO us.
        String clientIdSql = "SELECT id, client_code FROM clients WHERE smpp_username = ? AND status = 'active'";
        String supplierIdSql = "SELECT id, supplier_code FROM suppliers WHERE smpp_username = ? AND is_inbound = true AND status = 'active' AND (is_deleted IS NULL OR is_deleted = false)";
        try (Connection conn = getConnection()) {
            String clientCode = clientSystemId;
            Integer clientId = null;
            Integer supplierId = null;
            String supplierCode = null;

            try (PreparedStatement ps = conn.prepareStatement(clientIdSql)) {
                ps.setString(1, clientSystemId);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        clientId = rs.getInt("id");
                        clientCode = rs.getString("client_code");
                    }
                }
            }

            // Also look up as inbound supplier (GSM gateway submitting TO us)
            try (PreparedStatement ps = conn.prepareStatement(supplierIdSql)) {
                ps.setString(1, clientSystemId);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        supplierId = rs.getInt("id");
                        supplierCode = rs.getString("supplier_code");
                    }
                }
            }

            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, messageId);
                ps.setString(2, clientCode);
                ps.setString(3, sourceAddr);
                ps.setString(4, destAddr);
                ps.setString(5, message);
                ps.setInt(6, registeredDelivery);
                ps.setInt(7, dataCoding);
                ps.setInt(8, esmClass);
                ps.executeUpdate();
            }

            // If client found, update client_id
            if (clientId != null) {
                try (PreparedStatement ps = conn.prepareStatement(
                        "UPDATE sms_logs SET client_id = ? WHERE message_id = ?")) {
                    ps.setInt(1, clientId);
                    ps.setString(2, messageId);
                    ps.executeUpdate();
                }
            }

            // If inbound supplier found, set supplier_id + supplier_code on sms_logs.
            // This allows the SMPP relay poller and DLR timeout reporter to identify
            // messages from inbound gateways and push EXPIRED/UNDELIV back via deliver_sm.
            if (supplierId != null) {
                try (PreparedStatement ps = conn.prepareStatement(
                        "UPDATE sms_logs SET supplier_id = ?, supplier_code = ? WHERE message_id = ?")) {
                    ps.setInt(1, supplierId);
                    ps.setString(2, supplierCode);
                    ps.setString(3, messageId);
                    ps.executeUpdate();
                }
                log.info("Inbound SMS from supplier {} (#{}): {} → {} (msg={})",
                    supplierCode, supplierId, sourceAddr, destAddr, messageId);
            }

            return messageId;
        } catch (SQLException e) {
            log.error("Insert SMS log error: {}", e.getMessage());
            return messageId;
        }
    }

    /**
     * Count the number of queued/processing messages for a supplier.
     * Used by SmppServer to reject submit_sm when a supplier exceeds max_queue_size.
     */
    public static int getSupplierQueueDepth(int supplierId) {
        String sql = """
            SELECT COUNT(*) FROM sms_outbox
            WHERE supplier_id = ? AND status IN ('queued','processing')
            """;
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, supplierId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) return rs.getInt(1);
            }
        } catch (SQLException e) {
            log.error("Get supplier queue depth error: {}", e.getMessage());
        }
        return 0;
    }

    /**
     * Get a supplier's max_queue_size limit (0 = unlimited).
     */
    public static int getSupplierMaxQueueSize(int supplierId) {
        String sql = "SELECT COALESCE(max_queue_size, 1000) FROM suppliers WHERE id = ?";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, supplierId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) return rs.getInt(1);
            }
        } catch (SQLException e) {
            log.error("Get supplier max queue size error: {}", e.getMessage());
        }
        return 1000; // default
    }

    public static void updateDlr(String messageId, String state) {
        String dlrStatus = switch (state) {
            case "1" -> "DELIVRD";
            case "2" -> "EXPIRED";
            case "3" -> "DELETED";
            case "4" -> "UNDELIV";
            case "5" -> "ACCEPTD";
            case "6" -> "UNKNOWN";
            case "7" -> "REJECTD";
            default -> state;
        };
        String status = dlrStatus.equals("DELIVRD") ? "delivered" : "failed";

        String sql = "UPDATE sms_logs SET status = ?, dlr_status = ?, delivery_time = NOW() WHERE smpp_message_id = ? OR message_id = ?";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, status);
            ps.setString(2, dlrStatus);
            ps.setString(3, messageId);
            ps.setString(4, messageId);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Update DLR error: {}", e.getMessage());
        }
    }

    // ==================== Supplier Management ====================

    public static List<SupplierConfig> getActiveSuppliers() {
        List<SupplierConfig> list = new ArrayList<>();
        String sql = """
            SELECT id, supplier_code, company_name, connection_type,
                   smpp_host, smpp_port, smpp_username, smpp_password,
                   system_id, smpp_version, smpp_system_type, smpp_bind_type,
                   smpp_addr_ton, smpp_addr_npi, smpp_addr_range,
                   is_inbound, bind_status, consecutive_failures
            FROM suppliers
            WHERE status = 'active' AND (is_deleted IS NULL OR is_deleted = false)
            ORDER BY id
            """;
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                SupplierConfig cfg = new SupplierConfig();
                cfg.id = rs.getString("id");
                cfg.supplierCode = rs.getString("supplier_code");
                cfg.companyName = rs.getString("company_name");
                cfg.connectionType = rs.getString("connection_type");
                cfg.smppHost = rs.getString("smpp_host");
                cfg.smppPort = rs.getInt("smpp_port");
                cfg.smppUsername = rs.getString("smpp_username");
                cfg.smppPassword = rs.getString("smpp_password");
                cfg.systemType = rs.getString("smpp_system_type");
                cfg.smppVersion = rs.getString("smpp_version");
                cfg.addrTon = rs.getInt("smpp_addr_ton");
                cfg.addrNpi = rs.getInt("smpp_addr_npi");
                cfg.addrRange = rs.getString("smpp_addr_range");
                cfg.isInbound = rs.getBoolean("is_inbound");
                list.add(cfg);
            }
        } catch (SQLException e) {
            log.error("Get suppliers error: {}", e.getMessage());
        }
        return list;
    }

    public static void updateBindStatus(String supplierId, String status, int failures) {
        String sql = "UPDATE suppliers SET bind_status = ?, consecutive_failures = ?, updated_at = NOW() WHERE id = ?::integer";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, status);
            ps.setInt(2, failures);
            ps.setString(3, supplierId);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Update bind status error: {}", e.getMessage());
        }
    }

    public static void recordBindFailure(String supplierId) {
        String sql = "UPDATE suppliers SET consecutive_failures = consecutive_failures + 1, updated_at = NOW() WHERE id = ?::integer";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, supplierId);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Record bind failure error: {}", e.getMessage());
        }
    }

    // ==================== DLR Outbox Polling (for real-time deliver_sm push) ====================

    /**
     * DLR record from dlr_outbox — ready to be pushed to an SMPP client or supplier.
     */
    public static class PendingDlr {
        public long id;
        public String messageId;
        public String entityType;
        public int entityId;
        public int clientId;
        public String clientCode;
        public String destination;
        public String senderId;
        public String status;
        public String dlrReceipt;
        public java.sql.Timestamp submitTime;
    }

    /**
     * Fetch all pending DLRs that need to be pushed to SMPP clients.
     * Pending = smpp_pushed=false AND completed_at IS NULL.
     */
    public static List<PendingDlr> getPendingDlrs() {
        List<PendingDlr> list = new ArrayList<>();
        String sql = """
            SELECT id, message_id, entity_type, COALESCE(entity_id, client_id) as entity_id,
                   client_id, client_code, destination, sender_id,
                   status, dlr_receipt, submit_time
            FROM dlr_outbox
            WHERE smpp_pushed = false AND completed_at IS NULL
            ORDER BY created_at ASC
            LIMIT 100
            """;
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                PendingDlr dlr = new PendingDlr();
                dlr.id = rs.getLong("id");
                dlr.messageId = rs.getString("message_id");
                dlr.entityType = rs.getString("entity_type");
                dlr.entityId = rs.getInt("entity_id");
                dlr.clientId = rs.getInt("client_id");
                dlr.clientCode = rs.getString("client_code");
                dlr.destination = rs.getString("destination");
                dlr.senderId = rs.getString("sender_id");
                dlr.status = rs.getString("status");
                dlr.dlrReceipt = rs.getString("dlr_receipt");
                dlr.submitTime = rs.getTimestamp("submit_time");
                list.add(dlr);
            }
        } catch (SQLException e) {
            log.error("Get pending DLRs error: {}", e.getMessage());
        }
        return list;
    }

    /**
     * Mark a DLR as pushed to the SMPP client.
     */
    public static void markDlrPushed(long dlrOutboxId) {
        String sql = "UPDATE dlr_outbox SET smpp_pushed = true, completed_at = NOW() WHERE id = ?";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, dlrOutboxId);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Mark DLR pushed error: {}", e.getMessage());
        }
    }

    /**
     * Get the SMPP username for a DLR entity — checks both clients and suppliers.
     */
    public static String getEntitySmppUsername(String entityType, int entityId) {
        String sql;
        if ("supplier".equals(entityType)) {
            sql = "SELECT smpp_username FROM suppliers WHERE id = ?";
        } else {
            sql = "SELECT smpp_username FROM clients WHERE id = ?";
        }
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, entityId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) return rs.getString("smpp_username");
            }
        } catch (SQLException e) {
            log.error("Get {} SMPP username error: {}", entityType, e.getMessage());
        }
        return null;
    }

    // ==================== Inbound Supplier Session Tracking ====================

    /**
     * Look up a supplier by SMPP username (for inbound gateway binds).
     * Returns the supplier ID and code, or null if not found.
     */
    public static class SupplierLookup {
        public int id;
        public String supplierCode;
        public String companyName;
        public String smppUsername;
    }

    public static SupplierLookup lookupInboundSupplier(String systemId) {
        String sql = "SELECT id, supplier_code, company_name, smpp_username FROM suppliers WHERE smpp_username = ? AND is_inbound = true AND status = 'active' AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, systemId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    SupplierLookup s = new SupplierLookup();
                    s.id = rs.getInt("id");
                    s.supplierCode = rs.getString("supplier_code");
                    s.companyName = rs.getString("company_name");
                    s.smppUsername = rs.getString("smpp_username");
                    return s;
                }
            }
        } catch (SQLException e) {
            log.error("Lookup inbound supplier error: {}", e.getMessage());
        }
        return null;
    }

    /**
     * Look up a supplier by ID (for outbound delivery through inbound session).
     * Returns supplier code + smpp_username, or null if not found.
     */
    public static SupplierLookup lookupSupplierById(int supplierId) {
        String sql = "SELECT id, supplier_code, company_name, smpp_username FROM suppliers WHERE id = ? AND status = 'active' AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, supplierId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    SupplierLookup s = new SupplierLookup();
                    s.id = rs.getInt("id");
                    s.supplierCode = rs.getString("supplier_code");
                    s.companyName = rs.getString("company_name");
                    s.smppUsername = rs.getString("smpp_username");
                    return s;
                }
            }
        } catch (SQLException e) {
            log.error("Lookup supplier by ID error: {}", e.getMessage());
        }
        return null;
    }

    /**
     * Look up a client by SMPP username (for ESME binds).
     * Returns the client ID and code, or null if not found.
     */
    public static class ClientLookup {
        public int id;
        public String clientCode;
        public String companyName;
    }

    public static ClientLookup lookupClient(String systemId) {
        String sql = "SELECT id, client_code, company_name FROM clients WHERE smpp_username = ? AND status = 'active' AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, systemId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    ClientLookup c = new ClientLookup();
                    c.id = rs.getInt("id");
                    c.clientCode = rs.getString("client_code");
                    c.companyName = rs.getString("company_name");
                    return c;
                }
            }
        } catch (SQLException e) {
            log.error("Lookup client error: {}", e.getMessage());
        }
        return null;
    }

    /**
     * Record a client (ESME) bind in smpp_sessions and bind_history.
     * Called by SmppServer when an ESME client successfully binds.
     * Mirrors recordInboundSupplierBind but for entity_type='client'.
     */
    public static void recordClientBind(int clientId, String systemId, String ipAddress, int port, String negotiatedVersion) {
        // Upsert smpp_sessions
        String upsertSession = """
            INSERT INTO smpp_sessions (entity_type, entity_id, system_id, ip_address, remote_ip, port, bind_mode, status, connected_at, last_activity, negotiated_version)
            VALUES ('client', ?, ?, ?, ?, ?, 'BIND_TRX', 'bound', NOW(), NOW(), ?)
            ON CONFLICT (entity_type, entity_id)
            DO UPDATE SET system_id = EXCLUDED.system_id, ip_address = EXCLUDED.ip_address,
                          remote_ip = EXCLUDED.remote_ip, port = EXCLUDED.port,
                          status = 'bound', connected_at = NOW(),
                          last_activity = NOW(), negotiated_version = EXCLUDED.negotiated_version,
                          disconnected_at = NULL
            """;
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(upsertSession)) {
            ps.setInt(1, clientId);
            ps.setString(2, systemId);
            ps.setString(3, ipAddress);
            ps.setString(4, ipAddress);
            ps.setInt(5, port);
            ps.setString(6, negotiatedVersion);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Record client bind error: {}", e.getMessage());
        }

        // Insert bind_history
        String insertHistory = "INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, negotiated_version, created_at) VALUES ('client', ?, ?, ?, ?, 'BIND_TRX', 'bound', ?, NOW())";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(insertHistory)) {
            ps.setInt(1, clientId);
            ps.setString(2, systemId);
            ps.setString(3, ipAddress);
            ps.setInt(4, port);
            ps.setString(5, negotiatedVersion);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Record client bind history error: {}", e.getMessage());
        }
    }

    /**
     * Record a client (ESME) unbind in smpp_sessions and bind_history.
     * Called by SmppServer when an ESME client disconnects.
     */
    public static void recordClientUnbind(int clientId, String systemId, String ipAddress, int port) {
        // Update smpp_sessions
        String updateSession = "UPDATE smpp_sessions SET status = 'unbound', disconnected_at = NOW() WHERE entity_type = 'client' AND entity_id = ?";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(updateSession)) {
            ps.setInt(1, clientId);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Record client unbind error: {}", e.getMessage());
        }

        // Insert bind_history
        String insertHistory = "INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, created_at) VALUES ('client', ?, ?, ?, ?, 'BIND_TRX', 'unbound', NOW())";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(insertHistory)) {
            ps.setInt(1, clientId);
            ps.setString(2, systemId);
            ps.setString(3, ipAddress);
            ps.setInt(4, port);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Record client unbind history error: {}", e.getMessage());
        }
    }

    /**
     * Refresh last_activity timestamp for a client (ESME) session.
     * Called on every enquire_link so the Node.js health monitor
     * sees the session as alive.
     */
    public static void refreshClientLastActivity(int clientId) {
        String sql = "UPDATE smpp_sessions SET last_activity = NOW() WHERE entity_type = 'client' AND entity_id = ? AND status = 'bound'";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, clientId);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Refresh client last_activity error: {}", e.getMessage());
        }
    }

    /**
     * Record an inbound supplier bind in smpp_sessions and bind_history.
     * Called by SmppServer when an inbound GSM gateway successfully binds.
     */
    public static void recordInboundSupplierBind(int supplierId, String systemId, String ipAddress, int port, String negotiatedVersion) {
        // Upsert smpp_sessions
        String upsertSession = """
            INSERT INTO smpp_sessions (entity_type, entity_id, system_id, ip_address, remote_ip, port, bind_mode, status, connected_at, last_activity, negotiated_version)
            VALUES ('supplier', ?, ?, ?, ?, ?, 'BIND_TRX', 'bound', NOW(), NOW(), ?)
            ON CONFLICT (entity_type, entity_id)
            DO UPDATE SET system_id = EXCLUDED.system_id, ip_address = EXCLUDED.ip_address,
                          remote_ip = EXCLUDED.remote_ip, port = EXCLUDED.port,
                          status = 'bound', connected_at = NOW(),
                          last_activity = NOW(), negotiated_version = EXCLUDED.negotiated_version,
                          disconnected_at = NULL
            """;
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(upsertSession)) {
            ps.setInt(1, supplierId);
            ps.setString(2, systemId);
            ps.setString(3, ipAddress);
            ps.setString(4, ipAddress);
            ps.setInt(5, port);
            ps.setString(6, negotiatedVersion);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Record inbound supplier bind error: {}", e.getMessage());
        }

        // Update suppliers: set bind_status='bound', reset failures (instant visibility)
        String updateSupplier = "UPDATE suppliers SET bind_status = 'bound', consecutive_failures = 0, updated_at = NOW() WHERE id = ?";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(updateSupplier)) {
            ps.setInt(1, supplierId);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Update supplier bind status error: {}", e.getMessage());
        }

        // Insert bind_history
        String insertHistory = "INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, negotiated_version, created_at) VALUES ('supplier', ?, ?, ?, ?, 'BIND_TRX', 'bound', ?, NOW())";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(insertHistory)) {
            ps.setInt(1, supplierId);
            ps.setString(2, systemId);
            ps.setString(3, ipAddress);
            ps.setInt(4, port);
            ps.setString(5, negotiatedVersion);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Record bind history error: {}", e.getMessage());
        }
    }

    /**
     * Record an inbound supplier unbind in smpp_sessions and bind_history.
     * Called by SmppServer when an inbound GSM gateway disconnects.
     */
    public static void recordInboundSupplierUnbind(int supplierId, String systemId, String ipAddress, int port) {
        // Update smpp_sessions
        String updateSession = "UPDATE smpp_sessions SET status = 'unbound', disconnected_at = NOW() WHERE entity_type = 'supplier' AND entity_id = ?";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(updateSession)) {
            ps.setInt(1, supplierId);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Record inbound supplier unbind error: {}", e.getMessage());
        }

        // Update suppliers: set bind_status='unbound' (instant visibility)
        String updateSupplier = "UPDATE suppliers SET bind_status = 'unbound', updated_at = NOW() WHERE id = ?";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(updateSupplier)) {
            ps.setInt(1, supplierId);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Update supplier unbind status error: {}", e.getMessage());
        }

        // Insert bind_history
        String insertHistory = "INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, created_at) VALUES ('supplier', ?, ?, ?, ?, 'BIND_TRX', 'unbound', NOW())";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(insertHistory)) {
            ps.setInt(1, supplierId);
            ps.setString(2, systemId);
            ps.setString(3, ipAddress);
            ps.setInt(4, port);
            ps.executeUpdate();
        } catch (SQLException e) {
            log.error("Record bind history error: {}", e.getMessage());
        }
    }

    // ==================== Inbound Supplier Session Tracking (end) ====================

    /**
     * Refresh last_activity timestamp for an inbound supplier session.
     * Called on every enquire_link and submit_sm so the Node.js health
     * monitor sees the session as alive and doesn't unbound it.
     */
    public static void refreshSupplierLastActivity(int supplierId) {
        String sql = "UPDATE smpp_sessions SET last_activity = NOW() WHERE entity_type = 'supplier' AND entity_id = ? AND status = 'bound'";
        try (Connection conn = getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, supplierId);
            int updated = ps.executeUpdate();
            if (updated > 0) {
                // Also keep suppliers.bind_status in sync
                try (PreparedStatement ps2 = conn.prepareStatement(
                        "UPDATE suppliers SET bind_status = 'bound', consecutive_failures = 0, updated_at = NOW() WHERE id = ?")) {
                    ps2.setInt(1, supplierId);
                    ps2.executeUpdate();
                }
            }
        } catch (SQLException e) {
            log.error("Refresh supplier last_activity error: {}", e.getMessage());
        }
    }

    // ==================== Inbound Supplier Session Tracking (end) ====================

    public static class SupplierConfig {
        public String id;
        public String supplierCode;
        public String companyName;
        public String connectionType;
        public String smppHost;
        public int smppPort;
        public String smppUsername;
        public String smppPassword;
        public String systemType;
        public String smppVersion;
        public int addrTon;
        public int addrNpi;
        public String addrRange;
        public boolean isInbound;
    }
}
