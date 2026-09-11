package com.net2app.gateway.smpp;

import com.cloudhopper.smpp.SmppBindType;
import com.cloudhopper.smpp.SmppClient;
import com.cloudhopper.smpp.SmppSession;
import com.cloudhopper.smpp.SmppSessionConfiguration;
import com.cloudhopper.smpp.impl.DefaultSmppClient;
import com.cloudhopper.smpp.impl.DefaultSmppSessionHandler;
import com.cloudhopper.smpp.pdu.*;
import com.cloudhopper.smpp.type.Address;
import com.net2app.gateway.db.Database;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * SMPP Client Manager — connects to external SMSCs (suppliers).
 * Java 21 + Netty 4 via ch-smpp 6.x.
 */
public class SmppClientManager {
    private static final Logger log = LoggerFactory.getLogger(SmppClientManager.class);

    private final Map<String, SmppSession> activeSessions = new ConcurrentHashMap<>();
    private final Map<String, DefaultSmppClient> clients = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);

    public void startAll() {
        List<Database.SupplierConfig> suppliers = Database.getActiveSuppliers();
        for (Database.SupplierConfig cfg : suppliers) {
            if (!"smpp".equalsIgnoreCase(cfg.connectionType)) continue;
            if (cfg.isInbound) continue;
            connect(cfg);
        }
        scheduler.scheduleWithFixedDelay(() -> {
            for (Database.SupplierConfig cfg : suppliers) {
                if (!"smpp".equalsIgnoreCase(cfg.connectionType)) continue;
                if (cfg.isInbound) continue;
                SmppSession session = activeSessions.get(cfg.id);
                if (session == null || !session.isBound()) {
                    log.info("Reconnecting to supplier {}...", cfg.supplierCode);
                    connect(cfg);
                }
            }
        }, 60, 60, TimeUnit.SECONDS);
    }

    public SmppSession connect(Database.SupplierConfig cfg) {
        // Determine SMPP interface versions to try (auto-negotiation)
        byte[] versionsToTry = resolveVersions(cfg.smppVersion);
        // Bind types to try: TRANSCEIVER first, fall back to TRANSMITTER
        SmppBindType[] bindTypesToTry = {SmppBindType.TRANSCEIVER, SmppBindType.TRANSMITTER};
        Exception lastError = null;

        for (byte interfaceVersion : versionsToTry) {
            for (SmppBindType bindType : bindTypesToTry) {
                DefaultSmppClient clientBootstrap = null;
                try {
                    SmppSessionConfiguration sessionConfig = new SmppSessionConfiguration();
                    sessionConfig.setType(bindType);
                    sessionConfig.setHost(cfg.smppHost);
                    sessionConfig.setPort(cfg.smppPort);
                    sessionConfig.setSystemId(cfg.smppUsername);
                    sessionConfig.setPassword(cfg.smppPassword);
                    sessionConfig.setSystemType(cfg.systemType != null ? cfg.systemType : "SMPP");
                    sessionConfig.setInterfaceVersion(interfaceVersion);

                    String versionLabel = versionLabel(interfaceVersion);
                    String bindLabel = bindType == SmppBindType.TRANSCEIVER ? "TRX" : "TX";
                    log.info("Connecting to {} at {}:{} with SMPP v{} ({})",
                        cfg.supplierCode, cfg.smppHost, cfg.smppPort, versionLabel, bindLabel);

                    clientBootstrap = new DefaultSmppClient();
                    SmppSession session = clientBootstrap.bind(sessionConfig,
                        new SupplierSessionHandler(cfg.id, cfg.supplierCode));

                    activeSessions.put(cfg.id, session);
                    clients.put(cfg.id, clientBootstrap);

                    Database.updateBindStatus(cfg.id, "bound", 0);
                    log.info("Connected to supplier {} ({}) at {}:{} — SMPP v{} ({})",
                        cfg.supplierCode, cfg.companyName, cfg.smppHost, cfg.smppPort,
                        versionLabel, bindLabel);
                    return session;
                } catch (Exception e) {
                    lastError = e;
                    if (clientBootstrap != null) {
                        try { clientBootstrap.destroy(); } catch (Exception ex) { /* ignore */ }
                    }
                    String versionLabel = versionLabel(interfaceVersion);
                    String bindLabel = bindType == SmppBindType.TRANSCEIVER ? "TRX" : "TX";
                    log.warn("SMPP v{} ({}) bind failed for {} ({}): {} — will try next combination",
                        versionLabel, bindLabel, cfg.supplierCode, cfg.id, e.getMessage());
                }
            }
        }

        log.error("All SMPP version+bind attempts failed for supplier {} ({}): {}",
            cfg.supplierCode, cfg.id, lastError != null ? lastError.getMessage() : "unknown");
        Database.recordBindFailure(cfg.id);
        return null;
    }

    /**
     * Resolve SMPP interface versions to try in priority order.
     * If a specific version is configured, try it first, then fall back.
     * If "auto" or null, try all common versions.
     */
    private byte[] resolveVersions(String configuredVersion) {
        // Map of version labels to interface version bytes
        // 0x33 = SMPP 3.3, 0x34 = SMPP 3.4, 0x50 = SMPP 5.0
        List<Byte> versions = new ArrayList<>();

        if (configuredVersion != null && !configuredVersion.isEmpty() && !"auto".equalsIgnoreCase(configuredVersion)) {
            // Try the configured version first
            byte configured = versionToByte(configuredVersion);
            if (configured != 0) {
                versions.add(configured);
            }
        }

        // Add fallback versions (3.4 → 5.0 → 3.3) — most common order
        for (byte v : new byte[]{0x34, 0x50, 0x33}) {
            if (!versions.contains(v)) {
                versions.add(v);
            }
        }

        byte[] result = new byte[versions.size()];
        for (int i = 0; i < versions.size(); i++) result[i] = versions.get(i);
        return result;
    }

    private byte versionToByte(String version) {
        return switch (version.trim()) {
            case "3.3", "33" -> (byte) 0x33;
            case "3.4", "34" -> (byte) 0x34;
            case "5.0", "5", "50" -> (byte) 0x50;
            default -> {
                try { yield Byte.parseByte(version.trim(), 16); }
                catch (NumberFormatException e) { yield 0; }
            }
        };
    }

    private String versionLabel(byte interfaceVersion) {
        return switch (interfaceVersion) {
            case 0x33 -> "3.3";
            case 0x34 -> "3.4";
            case 0x50 -> "5.0";
            default -> String.format("0x%02X", interfaceVersion);
        };
    }

    public void disconnect(String supplierId) {
        SmppSession session = activeSessions.remove(supplierId);
        if (session != null) {
            session.unbind(5000);
            log.info("Disconnected from supplier {}", supplierId);
        }
        DefaultSmppClient client = clients.remove(supplierId);
        if (client != null) {
            client.destroy();
        }
    }

    public String submitSm(String supplierId, String sourceAddr, String destAddr,
                           String message, byte registeredDelivery, byte dataCoding) throws Exception {
        SmppSession session = activeSessions.get(supplierId);
        if (session == null || !session.isBound()) {
            throw new IllegalStateException("No active SMPP session for supplier " + supplierId);
        }

        byte[] shortMessage;
        if (dataCoding == 8) {
            shortMessage = message.getBytes("UTF-16BE");
        } else {
            shortMessage = message.getBytes("UTF-8");
        }

        SubmitSm submitSm = new SubmitSm();
        submitSm.setSourceAddress(new Address((byte) 5, (byte) 0, sourceAddr));
        submitSm.setDestAddress(new Address((byte) 1, (byte) 1, destAddr));
        submitSm.setShortMessage(shortMessage);
        submitSm.setRegisteredDelivery(registeredDelivery);
        submitSm.setDataCoding(dataCoding);

        SubmitSmResp resp = session.submit(submitSm, 10000);
        return resp.getMessageId();
    }

    public void stopAll() {
        activeSessions.forEach((id, session) -> {
            try { session.unbind(5000); } catch (Exception e) { /* ignore */ }
        });
        clients.forEach((id, client) -> {
            try { client.destroy(); } catch (Exception e) { /* ignore */ }
        });
        activeSessions.clear();
        clients.clear();
        scheduler.shutdown();
        log.info("All SMPP client connections stopped");
    }

    public Map<String, SmppSession> getActiveSessions() {
        return activeSessions;
    }

    private class SupplierSessionHandler extends DefaultSmppSessionHandler {
        private final String supplierId;
        private final String supplierCode;

        SupplierSessionHandler(String supplierId, String supplierCode) {
            this.supplierId = supplierId;
            this.supplierCode = supplierCode;
        }

        @Override
        public PduResponse firePduRequestReceived(PduRequest pduRequest) {
            if (pduRequest instanceof DeliverSm) {
                DeliverSm deliverSm = (DeliverSm) pduRequest;
                String messageId = "unknown";
                String state = "unknown";

                byte[] sm = deliverSm.getShortMessage();
                if (sm != null) {
                    String smText = new String(sm);
                    java.util.regex.Matcher idMatcher =
                        java.util.regex.Pattern.compile("id:([^\\s]+)").matcher(smText);
                    if (idMatcher.find()) messageId = idMatcher.group(1);
                    java.util.regex.Matcher statMatcher =
                        java.util.regex.Pattern.compile("stat:([^\\s]+)").matcher(smText);
                    if (statMatcher.find()) state = statMatcher.group(1);
                }

                log.info("DLR from {}: msgId={}, state={}", supplierCode, messageId, state);
                if (!"unknown".equals(messageId)) {
                    Database.updateDlr(messageId, state);
                }

                DeliverSmResp resp = deliverSm.createResponse();
                resp.setCommandStatus(0);
                return resp;
            }

            if (pduRequest instanceof EnquireLink) {
                PduResponse resp = pduRequest.createResponse();
                resp.setCommandStatus(0);
                return resp;
            }

            return super.firePduRequestReceived(pduRequest);
        }

        @Override
        public void fireChannelUnexpectedlyClosed() {
            log.warn("SMPP session to supplier {} closed unexpectedly!", supplierCode);
            activeSessions.remove(supplierId);
            Database.recordBindFailure(supplierId);
        }
    }
}
