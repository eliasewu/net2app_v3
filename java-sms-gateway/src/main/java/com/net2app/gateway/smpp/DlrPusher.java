package com.net2app.gateway.smpp;

import com.cloudhopper.smpp.SmppSession;
import com.cloudhopper.smpp.pdu.DeliverSm;
import com.cloudhopper.smpp.type.Address;
import com.cloudhopper.smpp.type.SmppInvalidArgumentException;
import com.net2app.gateway.db.Database;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * DLR Pusher — polls dlr_outbox every 5 seconds and pushes real-time
 * DeliverSm DLR receipts to connected SMPP clients (ESMEs).
 *
 * Flow:
 *   1. Node.js DLR poller detects DELIVRD/UNDELIV from suppliers
 *   2. Stores DLR in dlr_outbox (smpp_pushed=false)
 *   3. This pusher polls every 5s, finds pending DLRs
 *   4. Looks up the client's active SmppSession from SmppServer
 *   5. Builds and sends a DeliverSm PDU with the DLR receipt
 *   6. Marks smpp_pushed=true + completed_at=NOW() in dlr_outbox
 *
 * Only works for SMPP clients connected via SmppServer (port 2775).
 * Webhook clients are handled separately by the Node.js DLR webhook path.
 */
public class DlrPusher {
    private static final Logger log = LoggerFactory.getLogger(DlrPusher.class);

    private final SmppServer smppServer;
    private final ScheduledExecutorService scheduler;
    private volatile boolean running = false;

    public DlrPusher(SmppServer smppServer) {
        this.smppServer = smppServer;
        this.scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "dlr-pusher");
            t.setDaemon(true);
            return t;
        });
    }

    /**
     * Start polling dlr_outbox every 5 seconds.
     */
    public void start() {
        if (running) return;
        running = true;

        scheduler.scheduleWithFixedDelay(() -> {
            try {
                pollAndPush();
            } catch (Exception e) {
                log.error("DLR pusher error: {}", e.getMessage(), e);
            }
        }, 3, 5, TimeUnit.SECONDS);

        log.error("DLR Pusher STARTED — polling dlr_outbox every 5s for SMPP client delivery");
    }

    /**
     * One poll cycle: fetch pending DLRs, push to connected clients.
     */
    private void pollAndPush() {
        List<Database.PendingDlr> pending = Database.getPendingDlrs();
        // First-cycle heartbeat: confirm pusher is alive (use error level for visibility)
        if (pending.isEmpty()) {
            log.error("DLR pusher heartbeat: no pending DLRs ({} sessions active)", smppServer.getSessions().size());
            return;
        }

        Map<String, SmppSession> sessions = smppServer.getSessions();
        if (sessions.isEmpty()) {
            log.debug("DLR pusher: {} pending DLR(s) but no connected SMPP clients", pending.size());
            return;
        }

        int pushed = 0;
        int skipped = 0;

        for (Database.PendingDlr dlr : pending) {
            try {
                // Look up the entity's SMPP username to find their session.
                // Supports both 'client' and 'supplier' entity types.
                // Clients connect as ESMEs; suppliers connect as inbound GSM gateways.
                String entityType = dlr.entityType != null ? dlr.entityType : "client";
                int entityId = dlr.entityId > 0 ? dlr.entityId : dlr.clientId;
                String entityCode = dlr.clientCode != null ? dlr.clientCode : "unknown";

                String smppUsername = Database.getEntitySmppUsername(entityType, entityId);
                if (smppUsername == null) {
                    log.warn("DLR pusher: {}.id={} not found - skipping DLR {}", entityType, entityId, dlr.messageId);
                    Database.markDlrPushed(dlr.id);
                    skipped++;
                    continue;
                }

                SmppSession session = sessions.get(smppUsername);
                if (session == null || !session.isBound()) {
                    log.debug("DLR pusher: {} {} (session={}) not connected - DLR {} queued",
                        entityType, entityCode, smppUsername, dlr.messageId);
                    skipped++;
                    continue;
                }

                // Build and send the DeliverSm PDU
                DeliverSm deliverSm = buildDeliverSm(dlr);
                session.sendRequestPdu(deliverSm, 5000L, false);
                Database.markDlrPushed(dlr.id);

                log.error("DLR pusher: DELIVER_SM sent {} ({}) -> SMPP {} {} ({})",
                    dlr.messageId, dlr.status, entityType, entityCode, smppUsername);
                pushed++;
            } catch (Exception e) {
                log.error("DLR pusher: failed to push {} ({}): {}",
                    dlr.messageId, dlr.clientCode, e.getMessage());
                // Don't mark as pushed - retry on next cycle
            }
        }

        if (pushed > 0 || skipped > 0) {
            log.error("DLR pusher cycle: {} pushed, {} skipped ({} pending)",
                pushed, skipped, pending.size());
        }
    }

    /**
     * Build a DeliverSm PDU with a standard SMPP DLR receipt format.
     *
     * Format: "id:{message_id} sub:001 dlvrd:001 submit date:{YYMMDDhhmm}
     *          done date:{YYMMDDhhmm} stat:{DELIVRD|UNDELIV|...} err:000"
     */
    private DeliverSm buildDeliverSm(Database.PendingDlr dlr) throws SmppInvalidArgumentException {
        // Build the SMPP DLR receipt text
        SimpleDateFormat sdf = new SimpleDateFormat("yyMMddHHmm");
        String dateStr;
        if (dlr.submitTime != null) {
            dateStr = sdf.format(dlr.submitTime);
        } else {
            dateStr = sdf.format(new Date());
        }

        // Map internal status to SMPP stat codes
        String smppStat = switch (dlr.status != null ? dlr.status.toUpperCase() : "UNDELIV") {
            case "DELIVRD", "DELIVERED" -> "DELIVRD";
            case "UNDELIV", "FAILED" -> "UNDELIV";
            case "EXPIRED" -> "EXPIRED";
            case "REJECTD", "REJECTED" -> "REJECTD";
            default -> "UNDELIV";
        };

        String receipt = String.format(
            "id:%s sub:001 dlvrd:%s submit date:%s done date:%s stat:%s err:000 text:%s",
            dlr.messageId,
            smppStat.equals("DELIVRD") ? "001" : "000",
            dateStr, dateStr,
            smppStat,
            dlr.dlrReceipt != null ? dlr.dlrReceipt.replaceAll("[\\r\\n]", " ") : ""
        );

        DeliverSm deliverSm = new DeliverSm();
        // Source = destination number, Dest = sender ID (reversed for DLR)
        deliverSm.setSourceAddress(new Address((byte) 0, (byte) 0,
            dlr.destination != null ? dlr.destination : ""));
        deliverSm.setDestAddress(new Address((byte) 0, (byte) 0,
            dlr.senderId != null ? dlr.senderId : ""));
        deliverSm.setShortMessage(receipt.getBytes(StandardCharsets.US_ASCII));
        deliverSm.setEsmClass((byte) 0x04); // ESM_CLASS_DELIVERY_RECEIPT
        deliverSm.setRegisteredDelivery((byte) 0);
        deliverSm.setDataCoding((byte) 0);  // SMSC Default Alphabet

        return deliverSm;
    }

    /**
     * Stop the DLR pusher.
     */
    public void stop() {
        running = false;
        scheduler.shutdown();
        try {
            if (!scheduler.awaitTermination(5, TimeUnit.SECONDS)) {
                scheduler.shutdownNow();
            }
        } catch (InterruptedException e) {
            scheduler.shutdownNow();
            Thread.currentThread().interrupt();
        }
        log.info("DLR Pusher stopped");
    }
}
