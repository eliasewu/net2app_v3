-- ============================================================
-- PRODUCTION QUEUE MIGRATION
-- Adds sms_outbox table for async queue-based SMS processing
-- Designed for 1000+ clients and 1000+ suppliers
-- ============================================================

-- SMS Outbox Queue Table (PostgreSQL-based job queue)
CREATE TABLE IF NOT EXISTS sms_outbox (
    id BIGSERIAL PRIMARY KEY,
    message_id VARCHAR(100) UNIQUE NOT NULL,
    client_id INTEGER NOT NULL,
    client_code VARCHAR(50),
    supplier_id INTEGER,
    supplier_code VARCHAR(50),
    sender_id VARCHAR(100) NOT NULL,
    destination VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    message_parts INTEGER DEFAULT 1,
    client_rate DECIMAL(10,6) DEFAULT 0,
    supplier_rate DECIMAL(10,6) DEFAULT 0,
    profit DECIMAL(10,6) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'EUR',
    mcc VARCHAR(10),
    mnc VARCHAR(10),
    route_name VARCHAR(255),
    trunk_name VARCHAR(255),
    billing_mode VARCHAR(20) DEFAULT 'dlr',
    webhook_url TEXT,
    
    -- Message priority (higher = processed first)
    priority INTEGER DEFAULT 0,
    
    -- Queue state
    status VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued','processing','submitted','delivered','failed','dead_letter')),
    pipeline_id VARCHAR(50),
    attempt_count INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    next_attempt_at TIMESTAMP DEFAULT NOW(),
    last_attempt_at TIMESTAMP,
    last_error TEXT,
    dlr_status VARCHAR(20),
    dlr_received_at TIMESTAMP,
    
    -- Timing
    queued_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    -- Idempotency support
    idempotency_key VARCHAR(255)
);

-- ============================================================
-- HIGH-PERFORMANCE INDEXES FOR QUEUE POLLING
-- ============================================================

-- Primary poll index: workers claim queued jobs with FOR UPDATE SKIP LOCKED
-- This is THE most important index for the queue
CREATE INDEX IF NOT EXISTS idx_sms_outbox_poll 
    ON sms_outbox(status, next_attempt_at, priority DESC, queued_at) 
    WHERE status = 'queued';

-- Dead letter index for dashboard/reprocessing
CREATE INDEX IF NOT EXISTS idx_sms_outbox_dead 
    ON sms_outbox(status, completed_at) 
    WHERE status = 'dead_letter';

-- Client analytics
CREATE INDEX IF NOT EXISTS idx_sms_outbox_client 
    ON sms_outbox(client_id, queued_at);

-- Supplier analytics
CREATE INDEX IF NOT EXISTS idx_sms_outbox_supplier 
    ON sms_outbox(supplier_id, status);

-- Message lookups
CREATE INDEX IF NOT EXISTS idx_sms_outbox_message_id 
    ON sms_outbox(message_id);

-- Idempotency key lookups
CREATE INDEX IF NOT EXISTS idx_sms_outbox_idempotency 
    ON sms_outbox(idempotency_key) 
    WHERE idempotency_key IS NOT NULL;

-- Processing timeout detection (stuck jobs)
CREATE INDEX IF NOT EXISTS idx_sms_outbox_processing 
    ON sms_outbox(status, started_at) 
    WHERE status = 'processing';

-- ============================================================
-- ADDITIONAL PERFORMANCE INDEXES FOR sms_logs
-- ============================================================

-- Optimize the route resolution queries used in /api/sms/send
CREATE INDEX IF NOT EXISTS idx_routes_active_trunks ON routes(id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_trunks_active_supplier ON trunks(supplier_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(id, status) WHERE status = 'active';

-- Composite index for CDR queries
CREATE INDEX IF NOT EXISTS idx_sms_logs_cdr ON sms_logs(client_id, supplier_id, submit_time, status);

-- ============================================================
-- RECOVER STUCK JOBS FUNCTION
-- Jobs stuck in 'processing' state (worker crash) are reset to 'queued'
-- ============================================================
CREATE OR REPLACE FUNCTION recover_stuck_outbox_jobs(timeout_minutes INTEGER DEFAULT 5)
RETURNS INTEGER AS $$
DECLARE
    recovered_count INTEGER;
BEGIN
    UPDATE sms_outbox 
    SET status = 'queued', 
        next_attempt_at = NOW(),
        pipeline_id = NULL
    WHERE status = 'processing' 
      AND started_at < NOW() - (timeout_minutes || ' minutes')::INTERVAL;
    
    GET DIAGNOSTICS recovered_count = ROW_COUNT;
    RETURN recovered_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- OUTBOX CLEANUP FUNCTION
-- Removes old delivered/dead_letter entries to prevent table bloat
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_outbox(retention_days INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM sms_outbox 
    WHERE status IN ('delivered', 'dead_letter') 
      AND completed_at < NOW() - (retention_days || ' days')::INTERVAL
      AND idempotency_key IS NULL; -- Keep idempotency records longer
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE sms_outbox IS 'Async SMS processing queue. Workers poll with FOR UPDATE SKIP LOCKED. Supports 1000+ concurrent clients/suppliers.';
COMMENT ON COLUMN sms_outbox.priority IS 'Higher = processed first. Set for premium/OTP traffic.';
COMMENT ON COLUMN sms_outbox.idempotency_key IS 'Prevents duplicate SMS submission. Client-provided unique key.';
