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
        try {
            SmppSessionConfiguration sessionConfig = new SmppSessionConfiguration();
            sessionConfig.setType(SmppBindType.TRANSCEIVER);
            sessionConfig.setHost(cfg.smppHost);
            sessionConfig.setPort(cfg.smppPort);
            sessionConfig.setSystemId(cfg.smppUsername);
            sessionConfig.setPassword(cfg.smppPassword);
            sessionConfig.setSystemType(cfg.systemType != null ? cfg.systemType : "SMPP");

            DefaultSmppClient clientBootstrap = new DefaultSmppClient();
            SmppSession session = clientBootstrap.bind(sessionConfig,
                new SupplierSessionHandler(cfg.id, cfg.supplierCode));

            activeSessions.put(cfg.id, session);
            clients.put(cfg.id, clientBootstrap);

            Database.updateBindStatus(cfg.id, "bound", 0);
            log.info("Connected to supplier {} ({}) at {}:{}",
                cfg.supplierCode, cfg.companyName, cfg.smppHost, cfg.smppPort);
            return session;
        } catch (Exception e) {
            log.error("Failed to connect to supplier {} ({}): {}",
                cfg.supplierCode, cfg.id, e.getMessage());
            Database.recordBindFailure(cfg.id);
            return null;
        }
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
