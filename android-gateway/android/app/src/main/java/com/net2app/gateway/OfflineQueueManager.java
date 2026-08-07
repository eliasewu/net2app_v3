package com.net2app.gateway;

import android.content.Context;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Manages the persistent offline SMS queue using Room (SQLite).
 * All database operations run on a single-threaded executor
 * to avoid main-thread violations and ensure serialized access.
 */
public class OfflineQueueManager {

    private static final String TAG = "OfflineQueueManager";
    private static final int MAX_QUEUE_SIZE = 5000;

    private final OfflineMessageDao dao;
    private final ExecutorService dbExecutor;

    private volatile QueueChangeListener changeListener;

    public interface QueueChangeListener {
        void onQueueChanged(int pendingCount);
    }

    public OfflineQueueManager(Context context) {
        AppDatabase db = AppDatabase.getInstance(context);
        this.dao = db.offlineMessageDao();
        this.dbExecutor = Executors.newSingleThreadExecutor();
    }

    public void setChangeListener(QueueChangeListener listener) {
        this.changeListener = listener;
    }

    public int getPendingCount() {
        try {
            return dao.getPendingCount();
        } catch (Exception e) {
            Log.e(TAG, "getPendingCount error: " + e.getMessage());
            return 0;
        }
    }

    public int getTotalCount() {
        try {
            return dao.getTotalCount();
        } catch (Exception e) {
            return 0;
        }
    }

    /**
     * Enqueue a mobile-originated SMS.
     * All DB ops run on dbExecutor to avoid main-thread Room violations.
     */
    public void enqueueMoSms(String from, String text, long timestamp) {
        dbExecutor.execute(() -> {
            try {
                // Check queue limit
                int pending = dao.getPendingCount();
                if (pending >= MAX_QUEUE_SIZE) {
                    Log.w(TAG, "Queue full (" + MAX_QUEUE_SIZE + "), dropping MO from " + from);
                    return;
                }
                OfflineMessage msg = OfflineMessage.createMoSms(from, text, timestamp);
                dao.insert(msg);
                Log.d(TAG, "MO queued: " + from + " (pending: " + (pending + 1) + ")");
                fireChange();
            } catch (Exception e) {
                Log.e(TAG, "enqueueMoSms error: " + e.getMessage());
            }
        });
    }

    /**
     * Enqueue a MT delivery report.
     */
    public void enqueueMtDlr(String messageId, String dlrStatus, long timestamp, String status) {
        dbExecutor.execute(() -> {
            try {
                OfflineMessage msg = OfflineMessage.createMtDlr(messageId,
                        dlrStatus + ":" + status, timestamp);
                dao.insert(msg);
                Log.d(TAG, "DLR queued: " + messageId + " -> " + dlrStatus);
                fireChange();
            } catch (Exception e) {
                Log.e(TAG, "enqueueMtDlr error: " + e.getMessage());
            }
        });
    }

    /**
     * Get a batch of pending messages, marking them as syncing.
     */
    public List<OfflineMessage> getPendingBatch(int limit) {
        try {
            long now = System.currentTimeMillis();
            dao.markSyncing(limit, now);
            List<OfflineMessage> batch = dao.getSyncing();
            return batch != null ? batch : new ArrayList<>();
        } catch (Exception e) {
            Log.e(TAG, "getPendingBatch error: " + e.getMessage());
            return new ArrayList<>();
        }
    }

    /**
     * Mark a message as successfully sent.
     */
    public void markSent(long id) {
        dbExecutor.execute(() -> {
            try {
                dao.markSent(id, System.currentTimeMillis());
                fireChange();
            } catch (Exception e) {
                Log.e(TAG, "markSent error: " + e.getMessage());
            }
        });
    }

    /**
     * Mark a message as sent by matching source address, text, and timestamp.
     */
    public void markSentBySource(String from, String text, long timestamp) {
        dbExecutor.execute(() -> {
            try {
                // Find and mark matching message
                List<OfflineMessage> pending = dao.getPending(50);
                for (OfflineMessage msg : pending) {
                    if (msg.fromAddress != null && msg.fromAddress.equals(from) &&
                            msg.messageText != null && msg.messageText.equals(text) &&
                            Math.abs(msg.receivedAt - timestamp) < 5000) {
                        dao.markSent(msg.id, System.currentTimeMillis());
                        break;
                    }
                }
                fireChange();
            } catch (Exception e) {
                Log.e(TAG, "markSentBySource error: " + e.getMessage());
            }
        });
    }

    /**
     * Record a failed delivery attempt.
     */
    public void recordAttempt(long id) {
        dbExecutor.execute(() -> {
            try {
                dao.incrementAttempt(id, System.currentTimeMillis());
                // Check if max attempts exceeded
                List<OfflineMessage> syncing = dao.getSyncing();
                for (OfflineMessage msg : syncing) {
                    if (msg.id == id && msg.attemptCount >= msg.maxAttempts) {
                        dao.markFailed(id, System.currentTimeMillis());
                        Log.w(TAG, "Message " + id + " failed after " + msg.attemptCount + " attempts");
                    }
                }
                fireChange();
            } catch (Exception e) {
                Log.e(TAG, "recordAttempt error: " + e.getMessage());
            }
        });
    }

    /**
     * Clean up old sent messages (older than 7 days).
     */
    public void cleanup() {
        dbExecutor.execute(() -> {
            try {
                long cutoff = System.currentTimeMillis() - 7 * 24 * 60 * 60 * 1000L;
                int deleted = dao.cleanup(cutoff);
                if (deleted > 0) {
                    Log.i(TAG, "Cleaned up " + deleted + " old messages");
                }
            } catch (Exception e) {
                Log.e(TAG, "cleanup error: " + e.getMessage());
            }
        });
    }

    private void fireChange() {
        QueueChangeListener listener = changeListener;
        if (listener != null) {
            dbExecutor.execute(() -> {
                try {
                    int pending = dao.getPendingCount();
                    listener.onQueueChanged(pending);
                } catch (Exception e) {
                    // Ignore
                }
            });
        }
    }
}
