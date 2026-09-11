#!/bin/bash
# ============================================================
# Locate the pcap capture file(s) covering a given SMS message.
#
# Usage: sms_pcap.sh <message_id> [--copy <outdir>]
#
# Looks up the message's submit_time and delivery_time (DLR) from
# sms_logs, then finds the rotating capture files (smpp_YYYYMMDD_*.pcap)
# that overlap those timestamps. With --copy, merges/copies them into a
# per-message directory for handoff to the supplier/Wireshark.
# ============================================================
set -u

DB_NAME="${DB_NAME:-sms_platform}"
CAPDIR="${PCAP_DIR:-/var/log/net2app/pcap}"
MSG_ID="${1:-}"
COPYDIR=""

if [ $# -ge 2 ] && [ "$2" = "--copy" ]; then
  COPYDIR="${3:-/tmp/pcap_$MSG_ID}"
fi

if [ -z "$MSG_ID" ]; then
  echo "Usage: $0 <message_id> [--copy <outdir>]" >&2
  exit 2
fi

ROW=$(sudo -u postgres psql -d "$DB_NAME" -tA -F '|' -c \
  "SELECT COALESCE(submit_time::text,''), COALESCE(delivery_time::text,''), COALESCE(smpp_message_id,''), COALESCE(destination,''), COALESCE(sender_id,'') FROM sms_logs WHERE message_id='$MSG_ID' LIMIT 1" 2>/dev/null)

if [ -z "$ROW" ]; then
  echo "Message $MSG_ID not found in sms_logs" >&2
  exit 1
fi

IFS='|' read -r SUBMIT DLV SMSC_ID DEST SENDER <<< "$ROW"

echo "message_id : $MSG_ID"
echo "submit_time: ${SUBMIT:-n/a}"
echo "dlr_time   : ${DLV:-n/a}"
echo "smsc_id    : ${SMSC_ID:-n/a}"
echo "dest       : ${DEST:-n/a}  sender: ${SENDER:-n/a}"
echo

# Convert a Postgres timestamp to epoch seconds (Linux date).
to_epoch() {
  local t="$1"
  t="${t%% *} ${t##* }"           # split date + time (handle both date and ts)
  date -d "$t" +%s 2>/dev/null || echo 0
}

find_windows() {
  local t="$1" out="$2"
  [ -z "$t" ] && return
  local e
  e=$(to_epoch "$t")
  [ "$e" = "0" ] && return
  # Cover [t-60s, t+120s] — the submit_sm_resp and any fast DLR.
  local start=$((e - 60)) end=$((e + 120))
  for f in "$CAPDIR"/smpp_*.pcap; do
    [ -e "$f" ] || continue
    local name fe
    name=$(basename "$f" .pcap)
    name="${name#smpp_}"
    fe=$(date -d "${name:0:8} ${name:9:2}:${name:11:2}:${name:13:2}" +%s 2>/dev/null || echo 0)
    [ "$fe" = "0" ] && continue
    if [ "$fe" -ge $((start - 60)) ] && [ "$fe" -le "$end" ]; then
      echo "$f"
      [ -n "$out" ] && cp -f "$f" "$out/" 2>/dev/null
    fi
  done
}

echo "=== submit/DLR capture files ==="
FILES=$( { find_windows "$SUBMIT" "$COPYDIR"; find_windows "$DLV" "$COPYDIR"; } | sort -u )
if [ -z "$FILES" ]; then
  echo "(none found in $CAPDIR — capture may be older than retention, or not running)"
else
  echo "$FILES"
fi

if [ -n "$COPYDIR" ] && [ -n "$FILES" ]; then
  mkdir -p "$COPYDIR"
  { find_windows "$SUBMIT" "$COPYDIR"; find_windows "$DLV" "$COPYDIR"; } >/dev/null
  echo
  echo "Copied to: $COPYDIR"
fi

exit 0
