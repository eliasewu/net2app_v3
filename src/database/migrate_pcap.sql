-- Add pcap capture reference to sms_logs.
-- Each SMS records the rotating SMPP capture file (smpp_YYYYMMDD_HHMMSS.pcap)
-- covering its submit_time, so the submit_sm/deliver_sm packet exchange can be
-- pulled up for any message via scripts/sms_pcap.sh.
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS pcap_file VARCHAR(255);
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS pcap_dlr_file VARCHAR(255);
