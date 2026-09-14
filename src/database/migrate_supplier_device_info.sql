-- Suppliers: Android gateway device/SIM info reported with every heartbeat.
-- Populated by POST /api/gateway/heartbeat from the Net2appPro app.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS device_name VARCHAR(120);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS android_version VARCHAR(60);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sim_ready BOOLEAN;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sim_carrier VARCHAR(120);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sim_number VARCHAR(40);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_device_info_at TIMESTAMP;
