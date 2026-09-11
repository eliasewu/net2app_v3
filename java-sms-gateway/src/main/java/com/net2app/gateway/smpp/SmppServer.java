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
    // Sessions keyed by ch-smpp sessionId (unique per TCP connection).
    // NOTE: must NOT be keyed by systemId — multiple clients/suppliers share
    // the same system_id (e.g. several ESME boxes all bind as 'outgoing'), and
    // keying by systemId meant one connection unbinding wiped the map entry for
    // all the other still-connected sessions with the same systemId, silently
    // orphaning them so the DLR pusher could no longer find them.
    private final Map<Long, SmppSession> sessions = new ConcurrentHashMap<>();

    // sessionId -> "client:<id>" / "supplier:<id>" — lets us know which entity
    // each live session belongs to, so an unbind from ONE connection only marks
    // the entity unbound when NO other live session for it remains.
    private final Map<Long, String> sessionEntityKeys = new ConcurrentHashMap<>();

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
                session.serverReady(new EsmeSessionHandler(session, sessionId, systemId, finalEntityId, finalEntityType));
            }

            @Override
            public void sessionDestroyed(Long sessionId, SmppServerSession session) {
                String systemId = authBySessionId.remove(sessionId);
                if (systemId != null) {
                    sessions.remove(sessionId);
                    String entityKey = sessionEntityKeys.remove(sessionId);
                    String ipAddress = session.getConfiguration().getHost();
                    int port = session.getConfiguration().getPort();

                    // Only mark the entity unbound when NO other live session
                    // remains for it. Multiple connections share one system_id
                    // (e.g. several ESME boxes all bind as 'outgoing') — one of
                    // them unbinding must not flip the entity to unbound while
                    // its sibling sessions are still connected.
                    boolean stillConnected = false;
                    if (entityKey != null) {
                        for (Map.Entry<Long, SmppSession> e : sessions.entrySet()) {
                            if (entityKey.equals(sessionEntityKeys.get(e.getKey())) && e.getValue().isBound()) {
                                stillConnected = true;
                                break;
                            }
                        }
                    }

                    // Record unbind for whichever entity type (supplier or client)
                    Database.SupplierLookup supplier = Database.lookupInboundSupplier(systemId);
                    if (supplier != null) {
                        Database.recordInboundSupplierUnbind(supplier.id, systemId, ipAddress, port, stillConnected);
                        log.info("Inbound supplier {} (#{}) unbind recorded (still_connected={})",
                            supplier.supplierCode, supplier.id, stillConnected);
                    } else {
                        Database.ClientLookup client = Database.lookupClient(systemId);
                        if (client != null) {
                            Database.recordClientUnbind(client.id, systemId, ipAddress, port, stillConnected);
                            log.info("Client {} (#{}) unbind recorded (still_connected={})",
                                client.clientCode, client.id, stillConnected);
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
     * Get all active ESME sessions keyed by sessionId.
     * Used by DlrPusher / RestBridge to find sessions for deliver_sm push.
     */
    public Map<Long, SmppSession> getSessions() {
        return sessions;
    }

    /**
     * Live session count per entity ("client:1" -> 3, "supplier:5" -> 2).
     * Multiple connections may share one system_id, so this counts every bound
     * session owned by the entity. Exposed via GET /live-sessions so the Bind
     * Status page can show how many simultaneous connections each client has.
     */
    public Map<String, Integer> getLiveSessionCounts() {
        Map<String, Integer> counts = new java.util.HashMap<>();
        for (Map.Entry<Long, SmppSession> e : sessions.entrySet()) {
            if (!e.getValue().isBound()) continue;
            String key = sessionEntityKeys.get(e.getKey());
            if (key == null) continue;
            counts.merge(key, 1, Integer::sum);
        }
        return counts;
    }

    /**
     * Get an ESME session by systemId (smpp_username).
     *
     * Multiple connections may share the same systemId (e.g. several client
     * boxes all bind as 'outgoing'), so we return the first bound session whose
     * authenticated systemId matches — NOT a single map key, which was the old
     * bug (one unbind removed the shared entry for everyone).
     */
    public SmppSession getSession(String systemId) {
        if (systemId == null) return null;
        // authBySessionId maps sessionId -> authenticated systemId, so iterate
        // the live sessions and match on that (authoritative) mapping.
        for (Map.Entry<Long, SmppSession> e : sessions.entrySet()) {
            if (systemId.equals(authBySessionId.get(e.getKey())) && e.getValue().isBound()) {
                return e.getValue();
            }
        }
        return null;
    }

    /**
     * Drop an active ESME session by systemId (used by the Connect/Disconnect buttons
     * in the UI — Node.js calls POST /session/drop on the REST bridge).
     * Closes the TCP/SMPP session; sessionDestroyed() records the unbind in the DB.
     *
     * @return true if a bound session was found and closed
     */
    public boolean dropSession(String systemId) {
        if (systemId == null || systemId.isEmpty()) return false;
        boolean dropped = false;
        for (Map.Entry<Long, SmppSession> e : sessions.entrySet()) {
            if (systemId.equals(authBySessionId.get(e.getKey())) && e.getValue().isBound()) {
                try {
                    e.getValue().close();
                    dropped = true;
                } catch (Exception ex) {
                    log.error("dropSession: failed to close session {}: {}", systemId, ex.getMessage());
                }
            }
        }
        if (!dropped) {
            log.warn("dropSession: no bound session found for {}", systemId);
        }
        return dropped;
    }

    /**
     * Drop a session by entity type + id (looks up the SMPP username from the DB).
     */
    public boolean dropSessionByEntity(String entityType, int entityId) {
        String username = Database.getEntitySmppUsername(entityType, entityId);
        if (username == null) {
            log.warn("dropSessionByEntity: no smpp_username for {}.id={}", entityType, entityId);
            return false;
        }
        return dropSession(username);
    }

    /**
     * Per-session ESME handler — handles submit_sm, enquire_link, unbind.
     * Authentication is performed in sessionBindRequested() at the server level;
     * this handler receives the pre-authenticated systemId via constructor.
     */
    private class EsmeSessionHandler extends DefaultSmppSessionHandler {
        private final SmppSession session;
        private final Long boundSessionId;
        private final String boundSystemId;
        private final int cachedEntityId;   // cached entity ID (supplier or client)
        private final String entityType;    // "supplier" or "client"

        EsmeSessionHandler(SmppSession session, Long sessionId, String boundSystemId, int entityId, String entityType) {
            this.session = session;
            this.boundSessionId = sessionId;
            this.boundSystemId = boundSystemId;
            this.cachedEntityId = entityId;
            this.entityType = entityType;
            if (boundSystemId != null && sessionId != null) {
                sessions.put(sessionId, session);
                if (entityId > 0 && entityType != null) {
                    sessionEntityKeys.put(sessionId, entityType + ":" + entityId);
                }
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

            // Unbind — remove ONLY this connection's entry (keyed by sessionId),
            // never a shared systemId entry, so sibling connections stay findable.
            // NOTE: do NOT remove sessionEntityKeys here — sessionDestroyed() needs
            // it to decide whether sibling sessions are still live before writing
            // 'unbound' to smpp_sessions. Removing it here makes that check see
            // entityKey=null and wrongly flip the entity to unbound.
            if (pduRequest instanceof Unbind) {
                log.info("ESME {} unbound", boundSystemId);
                if (boundSessionId != null) {
                    sessions.remove(boundSessionId);
                }
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
                // Strip NUL (0x00) bytes and other invalid control chars that
                // PostgreSQL rejects as invalid UTF-8 ("invalid byte sequence
                // for encoding UTF8: 0x00"). 8-bit/GSM-encoded payloads often
                // carry 0x00 padding — dropping it keeps the readable OTP text
                // while guaranteeing the sms_logs insert succeeds.
                if (message.indexOf('\u0000') >= 0) {
                    message = message.replace("\u0000", "");
                    log.info("SMPP SANITIZED: stripped NUL bytes from message (len {} → {})",
                        submitSm.getShortMessage().length, message.length());
                }
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
                if (messageId == null) {
                    // DB insert failed — do NOT ACK a message we never stored.
                    // Return ESME_RUNKNOWNERR so the client can retry instead
                    // of believing the SMS was accepted.
                    log.error("submit_sm from {} NOT stored — returning NACK (0x45)", boundSystemId);
                    resp.setCommandStatus(0x00000045); // ESME_RUNKNOWNERR
                    return resp;
                }
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
