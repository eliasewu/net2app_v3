package com.net2app.gateway.smpp;

import com.cloudhopper.smpp.SmppServerConfiguration;
import com.cloudhopper.smpp.SmppServerHandler;
import com.cloudhopper.smpp.SmppServerSession;
import com.cloudhopper.smpp.SmppSession;
import com.cloudhopper.smpp.SmppSessionConfiguration;
import com.cloudhopper.smpp.impl.DefaultSmppServer;
import com.cloudhopper.smpp.impl.DefaultSmppSessionHandler;
import com.cloudhopper.smpp.pdu.*;
import com.cloudhopper.smpp.type.SmppChannelException;
import com.cloudhopper.smpp.type.SmppProcessingException;
import com.net2app.gateway.db.Database;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * SMPP Server — accepts ESME connections (server mode).
 * Java 21 + Netty 4 SMPP 3.4 via ch-smpp 6.x.
 */
public class SmppServer {
    private static final Logger log = LoggerFactory.getLogger(SmppServer.class);

    private final int port;
    private DefaultSmppServer server;
    private final Map<String, SmppSession> sessions = new ConcurrentHashMap<>();

    /**
     * Tracks authenticated systemId for each session.
     * ch-smpp auto-handles bind PDUs internally and may not forward them
     * to firePduRequestReceived(). This map bridges the gap:
     * sessionBindRequested() authenticates → stores systemId here →
     * the EsmeSessionHandler checks this map before processing PDUs.
     */
    private final Map<Long, String> authBySessionId = new ConcurrentHashMap<>();

    public SmppServer(int port) {
        this.port = port;
    }

    public void start() {
        SmppServerConfiguration config = new SmppServerConfiguration();
        config.setPort(port);
        config.setSystemId("NET2APP-SMPP");
        config.setInterfaceVersion((byte) 0x34);

        server = new DefaultSmppServer(config, new SmppServerHandler() {
            @Override
            public void sessionBindRequested(Long sessionId, SmppSessionConfiguration sessionConfig,
                                             BaseBind bindRequest) throws SmppProcessingException {
                // Authenticate the bind BEFORE ch-smpp accepts it.
                // This is the only reliable place to validate ESME credentials
                // because ch-smpp handles bind PDUs internally and may not
                // forward them to firePduRequestReceived().
                String systemId = bindRequest.getSystemId();
                String password = bindRequest.getPassword();

                boolean valid = Database.authenticateClient(systemId, password);
                if (!valid) {
                    valid = Database.authenticateSupplier(systemId, password);
                }

                if (valid) {
                    authBySessionId.put(sessionId, systemId);
                    log.info("SMPP bind accepted: {} (session {})", systemId, sessionId);
                } else {
                    log.warn("SMPP bind rejected: {} (session {}) — invalid credentials", systemId, sessionId);
                    throw new SmppProcessingException(0x0000000D, "Invalid credentials");
                }
            }

            @Override
            public void sessionCreated(Long sessionId, SmppServerSession session,
                                       BaseBindResp preparedBindResponse) throws SmppProcessingException {
                String systemId = authBySessionId.get(sessionId);
                String ipAddress = session.getConfiguration().getHost();
                int port = session.getConfiguration().getPort();
                String negotiatedVersion = String.format("%02X", session.getConfiguration().getInterfaceVersion());

                log.info("SMPP session {} established: {} from {}:{}",
                    sessionId, systemId != null ? systemId : "unknown", ipAddress, port);

                // Look up the entity (supplier or client) and record the bind in smpp_sessions + bind_history
                int cachedEntityId = 0;
                String entityType = null;

                if (systemId != null) {
                    // Check if this is an inbound supplier (GSM gateway)
                    Database.SupplierLookup supplier = Database.lookupInboundSupplier(systemId);
                    if (supplier != null) {
                        Database.recordInboundSupplierBind(supplier.id, systemId, ipAddress, port, negotiatedVersion);
                        cachedEntityId = supplier.id;
                        entityType = "supplier";
                        log.info("Inbound supplier {} (#{}) bind recorded in smpp_sessions (v{})",
                            supplier.supplierCode, supplier.id, negotiatedVersion);
                    } else {
                        // Check if this is a client (ESME)
                        Database.ClientLookup client = Database.lookupClient(systemId);
                        if (client != null) {
                            Database.recordClientBind(client.id, systemId, ipAddress, port, negotiatedVersion);
                            cachedEntityId = client.id;
                            entityType = "client";
                            log.info("Client {} (#{}) bind recorded in smpp_sessions (v{})",
                                client.clientCode, client.id, negotiatedVersion);
                        }
                    }
                }

                // Pass entity ID info to the handler so it can refresh last_activity
                // on every enquire_link / submit_sm without re-querying the DB.
                final int finalEntityId = cachedEntityId;
                final String finalEntityType = entityType;
                session.serverReady(new EsmeSessionHandler(session, systemId, finalEntityId, finalEntityType));
            }

            @Override
            public void sessionDestroyed(Long sessionId, SmppServerSession session) {
                String systemId = authBySessionId.remove(sessionId);
                if (systemId != null) {
                    sessions.remove(systemId);
                    String ipAddress = session.getConfiguration().getHost();
                    int port = session.getConfiguration().getPort();

                    // Record unbind for whichever entity type (supplier or client)
                    Database.SupplierLookup supplier = Database.lookupInboundSupplier(systemId);
                    if (supplier != null) {
                        Database.recordInboundSupplierUnbind(supplier.id, systemId, ipAddress, port);
                        log.info("Inbound supplier {} (#{}) unbind recorded",
                            supplier.supplierCode, supplier.id);
                    } else {
                        Database.ClientLookup client = Database.lookupClient(systemId);
                        if (client != null) {
                            Database.recordClientUnbind(client.id, systemId, ipAddress, port);
                            log.info("Client {} (#{}) unbind recorded",
                                client.clientCode, client.id);
                        }
                    }
                }
                log.info("SMPP session {} destroyed ({})", sessionId, systemId != null ? systemId : "anonymous");
            }
        });

        try {
            server.start();
            log.info("SMPP Server started on port {}", port);
        } catch (SmppChannelException e) {
            log.error("Failed to start SMPP server on port {}: {}", port, e.getMessage());
        }
    }

    public void stop() {
        if (server != null) {
            server.destroy();
            log.info("SMPP Server stopped");
        }
    }

    /**
     * Get all active ESME sessions keyed by smpp_username (systemId).
     * Used by DlrPusher to find the correct session for deliver_sm push.
     */
    public Map<String, SmppSession> getSessions() {
        return sessions;
    }

    /**
     * Get a specific ESME session by systemId.
     */
    public SmppSession getSession(String systemId) {
        return sessions.get(systemId);
    }

    /**
     * Per-session ESME handler — handles submit_sm, enquire_link, unbind.
     * Authentication is performed in sessionBindRequested() at the server level;
     * this handler receives the pre-authenticated systemId via constructor.
     */
    private class EsmeSessionHandler extends DefaultSmppSessionHandler {
        private final SmppSession session;
        private final String boundSystemId;
        private final int cachedEntityId;   // cached entity ID (supplier or client)
        private final String entityType;    // "supplier" or "client"

        EsmeSessionHandler(SmppSession session, String boundSystemId, int entityId, String entityType) {
            this.session = session;
            this.boundSystemId = boundSystemId;
            this.cachedEntityId = entityId;
            this.entityType = entityType;
            if (boundSystemId != null) {
                sessions.put(boundSystemId, session);
            }
        }

        /** Refresh last_activity for whichever entity type this session represents. */
        private void refreshActivity() {
            if (cachedEntityId <= 0 || entityType == null) return;
            if ("supplier".equals(entityType)) {
                Database.refreshSupplierLastActivity(cachedEntityId);
            } else if ("client".equals(entityType)) {
                Database.refreshClientLastActivity(cachedEntityId);
            }
        }

        @Override
        public PduResponse firePduRequestReceived(PduRequest pduRequest) {
            // Authentication already done in sessionBindRequested().
            // If boundSystemId is null, the session was never authenticated — reject all PDUs.
            if (boundSystemId == null) {
                log.warn("Unauthenticated PDU from {}", session.getConfiguration().getHost());
                PduResponse resp = pduRequest.createResponse();
                resp.setCommandStatus(0x0000000D);
                return resp;
            }

            // EnquireLink — keep-alive heartbeat
            if (pduRequest instanceof EnquireLink) {
                refreshActivity();
                PduResponse resp = pduRequest.createResponse();
                resp.setCommandStatus(0);
                return resp;
            }

            // Unbind
            if (pduRequest instanceof Unbind) {
                log.info("ESME {} unbound", boundSystemId);
                sessions.remove(boundSystemId);
                PduResponse resp = pduRequest.createResponse();
                resp.setCommandStatus(0);
                return resp;
            }

            // SubmitSm — the core SMS delivery PDU
            if (pduRequest instanceof SubmitSm) {
                refreshActivity();
                return handleSubmitSm((SubmitSm) pduRequest);
            }

            // DeliverSm — DLR receipt from inbound gateway
            if (pduRequest instanceof DeliverSm) {
                refreshActivity();
                return handleDeliverSm((DeliverSm) pduRequest);
            }

            // DeliverSmResp, DataSm, etc. — acknowledge silently
            PduResponse resp = pduRequest.createResponse();
            resp.setCommandStatus(0);
            return resp;
        }

        private PduResponse handleDeliverSm(DeliverSm deliverSm) {
            try {
                String receipt = new String(deliverSm.getShortMessage(), "UTF-8");
                log.info("SMPP DLR from {}: {}", boundSystemId, receipt.length() > 100 ? receipt.substring(0, 100) + "..." : receipt);

                // Parse standard SMPP DLR receipt format:
                // "id:SUBMITTED_MSG_ID sub:001 dlvrd:001 submit date:... done date:... stat:DELIVRD err:000 text:..."
                String msgId = null;
                String stat = null;

                // Extract id (the original message_id we sent)
                java.util.regex.Matcher idMatcher = java.util.regex.Pattern.compile("id:([^\\s]+)").matcher(receipt);
                if (idMatcher.find()) {
                    msgId = idMatcher.group(1);
                }

                // Extract stat (DELIVRD, UNDELIV, EXPIRED, etc.)
                java.util.regex.Matcher statMatcher = java.util.regex.Pattern.compile("stat:([^\\s]+)").matcher(receipt);
                if (statMatcher.find()) {
                    stat = statMatcher.group(1);
                }

                if (msgId != null && stat != null) {
                    log.info("SMPP DLR PARSED: msgId={} stat={} from {}", msgId, stat, boundSystemId);
                    Database.updateDlr(msgId, stat);

                    // Also insert into dlr_outbox so Node.js can push to external client
                    Database.insertDlrOutbox(msgId, stat, receipt);
                } else {
                    log.warn("SMPP DLR from {}: could not parse id/stat from receipt", boundSystemId);
                }

                DeliverSmResp resp = deliverSm.createResponse();
                resp.setCommandStatus(0);
                return resp;
            } catch (Exception e) {
                log.error("DeliverSm error: {}", e.getMessage());
                DeliverSmResp resp = deliverSm.createResponse();
                resp.setCommandStatus(0x00000045);
                return resp;
            }
        }

        private PduResponse handleSubmitSm(SubmitSm submitSm) {
            try {
                String sourceAddr = submitSm.getSourceAddress().getAddress();
                String destAddr = submitSm.getDestAddress().getAddress();
                String message = new String(submitSm.getShortMessage(), "UTF-8");
                log.info("SMPP SMS: {} → {} ({} chars)", sourceAddr, destAddr, message.length());

                // Inbound GSM gateways often have source/dest swapped:
                // the source is the real phone number and dest is our server IP.
                // Auto-swap: use source as the real destination, discard the IP.
                if (destAddr != null && destAddr.matches("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$")) {
                    if (sourceAddr != null && sourceAddr.matches("^\\d{5,15}$")) {
                        log.info("SMPP AUTO-SWAP: {} sent dest={} (server IP) — using source={} as destination",
                            boundSystemId, destAddr, sourceAddr);
                        destAddr = sourceAddr;
                        // sourceAddr stays as-is (will be used as sender_id by the relay poller)
                    } else {
                        log.warn("SMPP REJECTED: destination is server IP ({}) from {} and source is not a phone number",
                            destAddr, boundSystemId);
                        SubmitSmResp resp = submitSm.createResponse();
                        resp.setCommandStatus(0x0000000B);
                        return resp;
                    }
                }

                // Queue depth check for inbound suppliers (GSM gateways).
                // Prevents a single gateway from flooding the outbox and starving
                // other inbound suppliers of processing capacity.
                Database.SupplierLookup supplier = Database.lookupInboundSupplier(boundSystemId);
                if (supplier != null) {
                    int maxQueueSize = Database.getSupplierMaxQueueSize(supplier.id);
                    if (maxQueueSize > 0) {
                        int currentDepth = Database.getSupplierQueueDepth(supplier.id);
                        if (currentDepth >= maxQueueSize) {
                            log.warn("SMPP queue FULL for {} (#{}): {}/{} messages — rejecting submit_sm",
                                supplier.supplierCode, supplier.id, currentDepth, maxQueueSize);
                            SubmitSmResp resp = submitSm.createResponse();
                            resp.setCommandStatus(0x00000014); // ESME_RMSGQFUL — Message Queue Full
                            return resp;
                        }
                    }
                }

                String messageId = Database.insertSmsLog(
                    boundSystemId, sourceAddr, destAddr, message,
                    submitSm.getRegisteredDelivery(),
                    submitSm.getDataCoding(),
                    submitSm.getEsmClass()
                );

                SubmitSmResp resp = submitSm.createResponse();
                resp.setMessageId(messageId);
                resp.setCommandStatus(0);
                return resp;
            } catch (Exception e) {
                log.error("SubmitSm error: {}", e.getMessage());
                SubmitSmResp resp = submitSm.createResponse();
                resp.setCommandStatus(0x00000045);
                return resp;
            }
        }
    }
}
