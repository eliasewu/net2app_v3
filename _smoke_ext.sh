#!/usr/bin/env bash
set +e
cd /home/ubuntu/net2app-v3

echo '=== node -c ==='
node -c apiExtensions.cjs && echo 'apiExtensions.cjs OK'
node -c server.cjs && echo 'server.cjs OK'

pkill -f 'node server.cjs' 2>/dev/null || true
sleep 1

node server.cjs > /tmp/boot.log 2>&1 &
SRV=$!
sleep 4

echo ''
echo '=== boot log ==='
cat /tmp/boot.log

echo ''
echo '=== server alive? ==='
ps -p $SRV -o pid,stat,cmd 2>&1 | head -3

echo ''
echo '=== login ==='
LOGIN=$(curl -sS -X POST -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' http://localhost:3000/api/auth/login -m 10)
echo "login: $(echo $LOGIN | head -c 200)"
TOKEN=$(echo "$LOGIN" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);console.log(j.token||"")}catch{}})')
echo "token-prefix: ${TOKEN:0:30}"

echo ''
echo '=== probes ==='
P() {
  local M="$1" EP="$2" BODY="$3"
  local CODE BODYOUT
  if [ -n "$BODY" ]; then
    CODE=$(curl -sS -o /tmp/r -w '%{http_code}' -X $M -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d "$BODY" "http://localhost:3000$EP" -m 10)
  else
    CODE=$(curl -sS -o /tmp/r -w '%{http_code}' -X $M -H "Authorization: Bearer $TOKEN" "http://localhost:3000$EP" -m 10)
  fi
  BODYOUT=$(head -c 180 /tmp/r | tr -d '\n')
  printf "  %-7s %-46s HTTP %s  %s\n" "$M" "$EP" "$CODE" "$BODYOUT"
}
P POST '/api/sms/validate'                '{"client_id":1,"destination":"+13105551234","message":"hello"}'
P POST '/api/sms/dlr/batch'               '{"message_ids":["MSG123","MSG999"]}'
P GET  '/api/rates/history?entity_type=client&entity_id=1&mcc=310' ''
P POST '/api/rates/deactivate-old'        '{"rates":[{"entity_type":"client","entity_id":1,"mcc":"310","mnc":"260"}]}'
P POST '/api/rates/notify'                '{"entity_type":"client","entity_id":1,"rate_ids":[]}'
P GET  '/api/rates/destination?entity_type=client&entity_id=1&mcc=310' ''
P POST '/api/rates/update-destination'    '{"entity_type":"client","entity_id":1,"mcc":"310","new_rate":0.02,"mnc_list":["260","030"]}'
P POST '/api/invoices/generate'           '{"entity_type":"client","entity_id":1,"period_start":"2024-01-01","period_end":"2024-01-31"}'
P GET  '/api/invoices/1' ''
P GET  '/api/invoices/1/breakdown' ''
P GET  '/api/invoices/1/pdf' ''
P POST '/api/invoices/1/send'             '{}'
P POST '/api/invoices/1/mark-paid'        '{"payment_method":"wire","reference":"REF1"}'
P POST '/api/invoices/bulk-generate'      '{"entity_type":"client","entity_ids":[1,2],"period_start":"2024-01-01","period_end":"2024-01-31"}'
P POST '/api/payments'                    '{"entity_type":"client","entity_id":1,"amount":1.5,"currency":"EUR","payment_method":"wire","reference":"R1"}'
P GET  '/api/payments/history?entity_type=client&entity_id=1' ''
P POST '/api/payments/list'               '{}'
P PUT  '/api/payments/1/status'           '{"status":"completed"}'
P POST '/api/voice-otp/send'              '{"destination":"+12345678900","otp_code":"1234","language":"en-US"}'
P GET  '/api/voice-otp/languages' ''
P POST '/api/voice-otp/test'              '{"destination":"+12345678900","language":"en-US"}'
P PUT  '/api/voice-otp/sip-settings'      '{"host":"sip.example.com","port":5060,"username":"net2app","password":"x","caller_id":"NET2APP"}'
P POST '/api/translations/list'           '{}'
P POST '/api/translations/test'           '{"translation_type":"sender_id","source_pattern":"^HOT","target_value":"MARKETING","test_input":"HOT_N2A"}'
P POST '/api/translations'                '{"translation_type":"sender_id","source_pattern":"^OLD","target_value":"NEW"}'
P POST '/api/translations/apply'          '{"sender_id":"OLD_N2A","destination":"+13105551234","message":"hello"}'
P POST '/api/notifications/list'          '{}'
P POST '/api/notifications/send'          '{"template_name":"rate_change","variables":{"destination":"Spain"},"recipients":["ops@example.com"],"channel":"dashboard"}'
P POST '/api/notifications/rate-change'   '{"entity_type":"client","entity_id":1,"destination":"Spain","old_rate":0.05,"new_rate":0.04,"effective_date":"2024-12-01"}'
P POST '/api/notifications/low-balance'   '{"entity_type":"client","entity_id":1,"balance":5,"threshold":50}'
P POST '/api/notifications/dlr-failure'   '{"route_name":"R-EU","supplier_name":"SupA","failure_count":10,"action_taken":"disabled"}'
P PUT  '/api/billing/mode'                '{"entity_type":"client","entity_id":1,"billing_mode":"dlr"}'
P POST '/api/billing/charge/submit'       '{"entity_type":"client","entity_id":1,"message_id":"MSG9","amount":0.025}'
P POST '/api/billing/charge/dlr'          '{"entity_type":"client","entity_id":1,"message_id":"MSG9","amount":0.025,"dlr_status":"DELIVRD"}'
P POST '/api/billing/force-dlr'           '{"message_id":"MSG9","timeout_seconds":2}'
P GET  '/api/bind/1/history' ''
P GET  '/api/api-connectors' ''
P POST '/api/api-connectors'              '{"name":"smoke-conn","send_url":"http://example.com","http_method":"POST","auth_type":"NONE","is_active":true}'

kill $SRV 2>/dev/null || true
sleep 1
echo ''
echo 'done'
