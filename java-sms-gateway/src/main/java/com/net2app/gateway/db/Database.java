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

        // First, find the client_id from the smpp_username
        String clientIdSql = "SELECT id, client_code FROM clients WHERE smpp_username = ? AND status = 'active'";
        try (Connection conn = getConnection()) {
            String clientCode = clientSystemId;
            Integer clientId = null;

            try (PreparedStatement ps = conn.prepareStatement(clientIdSql)) {
                ps.setString(1, clientSystemId);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        clientId = rs.getInt("id");
                        clientCode = rs.getString("client_code");
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

            return messageId;
        } catch (SQLException e) {
            log.error("Insert SMS log error: {}", e.getMessage());
            return messageId;
        }
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
        public int addrTon;
        public int addrNpi;
        public String addrRange;
        public boolean isInbound;
    }
}
