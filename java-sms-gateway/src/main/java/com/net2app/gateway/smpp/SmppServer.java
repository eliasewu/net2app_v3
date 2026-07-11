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
                // Optional: pre-bind validation
            }

            @Override
            public void sessionCreated(Long sessionId, SmppServerSession session,
                                       BaseBindResp preparedBindResponse) throws SmppProcessingException {
                log.info("New SMPP session {} from {}", sessionId, session.getConfiguration().getHost());
                session.serverReady(new EsmeSessionHandler(session));
            }

            @Override
            public void sessionDestroyed(Long sessionId, SmppServerSession session) {
                log.info("SMPP session {} destroyed", sessionId);
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

    public Map<String, SmppSession> getSessions() {
        return sessions;
    }

    /**
     * Per-session ESME handler — handles bind, submit_sm, enquire_link, unbind.
     */
    private class EsmeSessionHandler extends DefaultSmppSessionHandler {
        private final SmppSession session;
        private boolean authenticated = false;
        private String boundSystemId = null;

        EsmeSessionHandler(SmppSession session) {
            this.session = session;
        }

        @Override
        public PduResponse firePduRequestReceived(PduRequest pduRequest) {
            // Handle bind requests
            if (pduRequest instanceof BindTransceiver) {
                return handleBind((BindTransceiver) pduRequest);
            } else if (pduRequest instanceof BindTransmitter) {
                return handleBind((BindTransmitter) pduRequest);
            } else if (pduRequest instanceof BindReceiver) {
                return handleBind((BindReceiver) pduRequest);
            }

            // All subsequent PDUs require authentication
            if (!authenticated) {
                log.warn("Unauthenticated PDU from {}", session.getConfiguration().getHost());
                PduResponse resp = pduRequest.createResponse();
                resp.setCommandStatus(0x0000000D);
                return resp;
            }

            if (pduRequest instanceof SubmitSm) {
                return handleSubmitSm((SubmitSm) pduRequest);
            }
            if (pduRequest instanceof EnquireLink) {
                PduResponse resp = pduRequest.createResponse();
                resp.setCommandStatus(0);
                return resp;
            }
            if (pduRequest instanceof Unbind) {
                authenticated = false;
                log.info("ESME {} unbound", boundSystemId);
                sessions.remove(boundSystemId);
                PduResponse resp = pduRequest.createResponse();
                resp.setCommandStatus(0);
                return resp;
            }

            return super.firePduRequestReceived(pduRequest);
        }

        private PduResponse handleBind(BindTransceiver bind) {
            return authenticate(bind.getSystemId(), bind.getPassword());
        }
        private PduResponse handleBind(BindTransmitter bind) {
            return authenticate(bind.getSystemId(), bind.getPassword());
        }
        private PduResponse handleBind(BindReceiver bind) {
            return authenticate(bind.getSystemId(), bind.getPassword());
        }

        private PduResponse authenticate(String systemId, String password) {
            try {
                boolean valid = Database.authenticateClient(systemId, password);
                if (!valid) {
                    valid = Database.authenticateSupplier(systemId, password);
                }
                if (valid) {
                    authenticated = true;
                    boundSystemId = systemId;
                    sessions.put(systemId, session);
                    log.info("ESME {} authenticated (BOUND_TRX)", systemId);
                    BindTransceiverResp resp = new BindTransceiverResp();
                    resp.setSystemId("NET2APP-SMPP");
                    resp.setCommandStatus(0);
                    return resp;
                } else {
                    log.warn("Auth failed for {}", systemId);
                    BindTransceiverResp resp = new BindTransceiverResp();
                    resp.setCommandStatus(0x0000000D);
                    return resp;
                }
            } catch (Exception e) {
                log.error("Auth error for {}: {}", systemId, e.getMessage());
                BindTransceiverResp resp = new BindTransceiverResp();
                resp.setCommandStatus(0x0000000D);
                return resp;
            }
        }

        private PduResponse handleSubmitSm(SubmitSm submitSm) {
            try {
                String sourceAddr = submitSm.getSourceAddress().getAddress();
                String destAddr = submitSm.getDestAddress().getAddress();
                String message = new String(submitSm.getShortMessage(), "UTF-8");
                log.info("SMPP SMS: {} → {} ({} chars)", sourceAddr, destAddr, message.length());

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
