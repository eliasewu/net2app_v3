#!/bin/bash
# ============================================================
# SMPP packet capture service — continuous rotating pcap.
#
# Captures ALL SMPP traffic (tcp port 2775, both directions) so
# every SMS submit_sm / deliver_sm exchange is recorded on disk.
# Files rotate every 60s and are named with their start timestamp
# (smpp_YYYYMMDD_HHMMSS.pcap) so a message's pcap can be located
# from its submit_time. Captures older than 2 hours are deleted.
#
# Used by: `sms_pcap.sh <message_id>` lookup helper + sms_logs.pcap_file.
# ============================================================
set -u

CAPDIR="${PCAP_DIR:-/var/log/net2app/pcap}"
RETENTION_MIN="${PCAP_RETENTION_MIN:-120}"
ROTATE_SEC="${PCAP_ROTATE_SEC:-60}"
FILTER="${PCAP_FILTER:-tcp port 2775}"

mkdir -p "$CAPDIR"

# tcpdump drops root privileges to the 'tcpdump' user (default), so that user
# must own the capture dir — otherwise each rotated file fails with
# "Permission denied" and tcpdump silently exits. Keep it owned by tcpdump.
chown tcpdump:tcpdump "$CAPDIR" 2>/dev/null || true

echo "[pcap] Starting capture → $CAPDIR (rotate ${ROTATE_SEC}s, retain ${RETENTION_MIN}min, filter: $FILTER)"

# Retention cleanup runs in the background; tcpdump stays in the foreground
# so systemd (Restart=always) actually restarts it if tcpdump ever exits.
while true; do
  find "$CAPDIR" -name 'smpp_*.pcap' -mmin "+${RETENTION_MIN}" -delete 2>/dev/null
  sleep 60
done &
CLEANUP_PID=$!

cleanup() {
  kill "$CLEANUP_PID" 2>/dev/null
  exit 0
}
trap cleanup TERM INT

# Continuous capture. `-G` + strftime in `-w` names each file by its start time.
# `-s 0` = full packet, `-nn` = no name/port resolution, `-i any` = all interfaces.
# `-U` = unbuffered writes (so partial capture files are usable immediately).
# Runs in foreground via exec so tcpdump is the service's main process.
exec tcpdump -i any -nn -U -s 0 -G "$ROTATE_SEC" \
  -w "$CAPDIR/smpp_%Y%m%d_%H%M%S.pcap" \
  "$FILTER"
