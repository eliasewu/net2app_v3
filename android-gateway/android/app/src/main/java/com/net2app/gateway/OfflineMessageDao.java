package com.net2app.gateway;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.Query;
import androidx.room.Update;

import java.util.List;

@Dao
public interface OfflineMessageDao {

    @Insert
    long insert(OfflineMessage message);

    @Query("SELECT * FROM offline_messages WHERE status = 'pending' ORDER BY created_at ASC LIMIT :limit")
    List<OfflineMessage> getPending(int limit);

    @Query("SELECT COUNT(*) FROM offline_messages WHERE status = 'pending'")
    int getPendingCount();

    @Query("SELECT COUNT(*) FROM offline_messages")
    int getTotalCount();

    @Query("UPDATE offline_messages SET status = 'syncing', last_attempt_at = :now WHERE id IN " +
           "(SELECT id FROM offline_messages WHERE status = 'pending' ORDER BY created_at ASC LIMIT :limit)")
    int markSyncing(int limit, long now);

    @Query("SELECT * FROM offline_messages WHERE status = 'syncing'")
    List<OfflineMessage> getSyncing();

    @Query("UPDATE offline_messages SET status = 'sent', last_attempt_at = :now WHERE id = :id")
    int markSent(long id, long now);

    @Query("UPDATE offline_messages SET status = 'failed', last_attempt_at = :now WHERE id = :id")
    int markFailed(long id, long now);

    @Query("UPDATE offline_messages SET attempt_count = attempt_count + 1, " +
           "last_attempt_at = :now WHERE id = :id")
    int incrementAttempt(long id, long now);

    @Query("DELETE FROM offline_messages WHERE status = 'sent' AND created_at < :before")
    int cleanup(long before);

    @Query("SELECT status, COUNT(*) as count FROM offline_messages GROUP BY status")
    List<StatusCount> getStatusCounts();

    // Inner class for aggregation results
    class StatusCount {
        public String status;
        public int count;
    }
}
