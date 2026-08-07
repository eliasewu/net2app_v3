package com.net2app.gateway;

import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.Ignore;
import androidx.room.PrimaryKey;

/**
 * Offline message entity for the persistent SMS queue.
 * Stores MO SMS and MT DLRs that couldn't be delivered immediately.
 * Survives app restarts and phone reboots.
 */
@Entity(tableName = "offline_messages")
public class OfflineMessage {

    @PrimaryKey(autoGenerate = true)
    public long id;

    /** "mo" = mobile-originated SMS, "dlr" = delivery report */
    @ColumnInfo(name = "direction")
    public String direction;

    /** Sender address (for MO) or message ID (for DLR) */
    @ColumnInfo(name = "from_address")
    public String fromAddress;

    /** SMS text content */
    @ColumnInfo(name = "message_text")
    public String messageText;

    /** Receipt timestamp (epoch ms) */
    @ColumnInfo(name = "received_at")
    public long receivedAt;

    /** Status: "pending", "syncing", "sent", "failed" */
    @ColumnInfo(name = "status")
    public String status;

    /** Number of delivery attempts */
    @ColumnInfo(name = "attempt_count")
    public int attemptCount;

    /** Max attempts before giving up */
    @ColumnInfo(name = "max_attempts")
    public int maxAttempts;

    /** Last attempt timestamp */
    @ColumnInfo(name = "last_attempt_at")
    public long lastAttemptAt;

    /** Created timestamp */
    @ColumnInfo(name = "created_at")
    public long createdAt;

    @Ignore
    private transient String cachedPayload;

    // Static factory methods

    public static OfflineMessage createMoSms(String from, String text, long timestamp) {
        OfflineMessage msg = new OfflineMessage();
        msg.direction = "mo";
        msg.fromAddress = sanitize(from);
        msg.messageText = sanitize(text);
        msg.receivedAt = timestamp > 0 ? timestamp : System.currentTimeMillis();
        msg.status = "pending";
        msg.attemptCount = 0;
        msg.maxAttempts = 10;
        msg.lastAttemptAt = 0;
        msg.createdAt = System.currentTimeMillis();
        return msg;
    }

    public static OfflineMessage createMtDlr(String messageId, String dlrStatus, long timestamp) {
        OfflineMessage msg = new OfflineMessage();
        msg.direction = "dlr";
        msg.fromAddress = sanitize(messageId);
        msg.messageText = sanitize(dlrStatus);
        msg.receivedAt = timestamp > 0 ? timestamp : System.currentTimeMillis();
        msg.status = "pending";
        msg.attemptCount = 0;
        msg.maxAttempts = 10;
        msg.lastAttemptAt = 0;
        msg.createdAt = System.currentTimeMillis();
        return msg;
    }

    public String toPayloadJson() {
        if (cachedPayload == null) {
            cachedPayload = "{\"dir\":\"" + direction + "\",\"from\":\"" +
                    escapeJson(fromAddress) + "\",\"text\":\"" +
                    escapeJson(messageText) + "\",\"ts\":" + receivedAt + "}";
        }
        return cachedPayload;
    }

    private static String sanitize(String s) {
        return s != null ? s : "";
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }
}
