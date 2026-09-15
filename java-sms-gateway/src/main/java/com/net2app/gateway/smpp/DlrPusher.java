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
 * DLR Pusher — pushes DeliverSm DLR receipts to connected SMPP clients (ESMEs).
 *
 * Two push paths:
 *   1. Immediate: Node.js calls POST /dlr/push on the REST bridge the moment a
 *      supplier DLR arrives — pushDlr() delivers the deliver_sm right away.
 *   2. Poller: every 5 seconds, pending rows in dlr_outbox (smpp_pushed=false)
 *      are retried. This is the fallback for clients that weren't connected at
 *      the moment the DLR arrived, or for retries after a failed immediate push.
 *
 * Flow:
 *   1. Node.js DLR poller detects DELIVRD/UNDELIV from suppliers
 *   2. Stores DLR in dlr_outbox (smpp_pushed=false)
 *   3. This pusher (immediate via REST, or every 5s) finds the pending DLR
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
     * Start polling dlr_outbox every 5 seconds (fallback for offline/retry).
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

        log.info("DLR Pusher STARTED — polling dlr_outbox every 5s for SMPP client delivery");
    }

    /**
     * One poll cycle: fetch pending DLRs, push to connected clients.
     */
    private void pollAndPush() {
        List<Database.PendingDlr> pending = Database.getPendingDlrs();
        // Idle heartbeat. This runs every 5s, so it must stay at DEBUG: logging it
        // at ERROR buried real failures under ~100k "heartbeat" lines a day.
        if (pending.isEmpty()) {
            log.debug("DLR pusher heartbeat: no pending DLRs ({} sessions active)", smppServer.getSessions().size());
            return;
        }

        int pushed = 0;
        int skipped = 0;

        for (Database.PendingDlr dlr : pending) {
            try {
                if (pushDlr(smppServer, dlr)) {
                    pushed++;
                } else {
                    skipped++;
                }
            } catch (Exception e) {
                log.error("DLR pusher: failed to push {} ({}): {}",
                    dlr.messageId, dlr.clientCode, e.getMessage());
                skipped++;
            }
        }

        if (pushed > 0 || skipped > 0) {
            log.info("DLR pusher cycle: {} pushed, {} skipped ({} pending)",
                pushed, skipped, pending.size());
        }
    }

    /**
     * Push a single DLR immediately to the entity's connected SMPP session.
     *
     * Looks up the entity's SMPP username, finds their bound session, builds the
     * DeliverSm receipt PDU, sends it, and marks the dlr_outbox row pushed.
     *
     * @return true if the deliver_sm was actually sent to a bound session.
     *         false if the entity is unknown or not currently connected
     *         (row is left in dlr_outbox for the 5s poller to retry).
     */
    public static boolean pushDlr(SmppServer smppServer, Database.PendingDlr dlr) {
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
            return false;
        }

        SmppSession session = smppServer.getSession(smppUsername);
        if (session == null || !session.isBound()) {
            log.debug("DLR pusher: {} {} (session={}) not connected - DLR {} queued",
                entityType, entityCode, smppUsername, dlr.messageId);
            return false;
        }

        // Build and send the DeliverSm PDU
        try {
            DeliverSm deliverSm = buildDeliverSm(dlr);
            session.sendRequestPdu(deliverSm, 5000L, false);
        } catch (Exception e) {
            log.error("DLR pusher: failed to send deliver_sm {} ({}): {}",
                dlr.messageId, entityCode, e.getMessage());
            return false;
        }
        Database.markDlrPushed(dlr.id);

        log.error("DLR pusher: DELIVER_SM sent {} ({}) -> SMPP {} {} ({})",
            dlr.messageId, dlr.status, entityType, entityCode, smppUsername);
        return true;
    }

    /**
     * Build a DeliverSm PDU with a standard SMPP DLR receipt format.
     *
     * Format: "id:{message_id} sub:001 dlvrd:001 submit date:{YYMMDDhhmm}
     *          done date:{YYMMDDhhmm} stat:{DELIVRD|UNDELIV|...} err:000"
     */
    private static DeliverSm buildDeliverSm(Database.PendingDlr dlr) throws SmppInvalidArgumentException {
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

        // Base receipt without the supplier's raw text — the critical fields
        // (id/stat/err) always fit. The text: suffix is appended separately and
        // truncated to respect SMPP's hard 255-byte short_message limit.
        String receipt = String.format(
            "id:%s sub:001 dlvrd:%s submit date:%s done date:%s stat:%s err:000",
            dlr.messageId,
            smppStat.equals("DELIVRD") ? "001" : "000",
            dateStr, dateStr,
            smppStat
        );

        String receiptText = dlr.dlrReceipt != null ? dlr.dlrReceipt.replaceAll("[\\r\\n]", " ") : "";
        if (!receiptText.isEmpty()) {
            // SMPP short_message is capped at 255 bytes; Cloudhopper rejects
            // anything larger ("A short message in a PDU can only be a max of
            // 255 bytes"). If the supplier's raw receipt text would overflow,
            // truncate the trailing text: so the deliver_sm can actually be sent.
            int budget = 255 - receipt.getBytes(StandardCharsets.US_ASCII).length - " text:".length();
            if (budget > 0) {
                String text = receiptText;
                byte[] textBytes = text.getBytes(StandardCharsets.US_ASCII);
                if (textBytes.length > budget) {
                    text = new String(java.util.Arrays.copyOf(textBytes, budget), StandardCharsets.US_ASCII);
                }
                receipt += " text:" + text;
            }
        }

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
