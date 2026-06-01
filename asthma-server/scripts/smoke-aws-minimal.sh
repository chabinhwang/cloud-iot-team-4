#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_FILE="$ROOT_DIR/.omx/state/aws-minimal.env"
if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi

REGION="${AWS_REGION:-${REGION:-$(aws configure get region)}}"
REGION="${REGION:-ap-northeast-2}"
API_ENDPOINT="${API_ENDPOINT:?Set API_ENDPOINT or run deploy-aws-minimal.sh first}"
IOT_ENDPOINT="${IOT_ENDPOINT:?Set IOT_ENDPOINT or run deploy-aws-minimal.sh first}"
TABLE_NAME="${TABLE_NAME:-AsthmaGuideData}"
USER_ID="${DEFAULT_USER_ID:-user_001}"
DEVICE_ID="${DEFAULT_DEVICE_ID:-rpi_001}"
DATE="${SMOKE_DATE:-$(TZ=Asia/Seoul date +%F)}"
TS="${SMOKE_TS:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

print_json() {
  python3 -m json.tool 2>/dev/null || cat
}

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local tmp status
  tmp="$(mktemp)"
  if [[ -n "$body" ]]; then
    status="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$API_ENDPOINT$path" -H 'content-type: application/json' -d "$body")"
  else
    status="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$API_ENDPOINT$path")"
  fi
  printf '\n[smoke] %s %s -> HTTP %s\n' "$method" "$path" "$status"
  cat "$tmp" | print_json
  rm -f "$tmp"
  [[ "$status" =~ ^2[0-9][0-9]$ ]]
}

printf '[smoke] API_ENDPOINT=%s\n' "$API_ENDPOINT"
printf '[smoke] IOT_ENDPOINT=%s\n' "$IOT_ENDPOINT"
printf '[smoke] TABLE_NAME=%s REGION=%s\n' "$TABLE_NAME" "$REGION"

request GET /health
request POST /measurements/environment "{\"device_id\":\"$DEVICE_ID\",\"timestamp\":\"$TS\",\"pm25\":32.4,\"pm10\":55.1,\"co2\":1250,\"voc\":0.58,\"temperature\":25.2,\"humidity\":64}"
request POST /biometrics/fitbit "{\"user_id\":\"$USER_ID\",\"date\":\"$DATE\",\"sleep_minutes\":320,\"avg_spo2\":92,\"respiratory_rate\":23,\"resting_hr\":82,\"hrv\":18}"
request POST /google-health/fitbit/sync "{\"user_id\":\"$USER_ID\",\"date\":\"$DATE\"}"
request POST /biometrics/fitbit/notify "{\"user_id\":\"$USER_ID\",\"date\":\"$DATE\",\"sleep_minutes\":330,\"avg_spo2\":94,\"respiratory_rate\":20,\"resting_hr\":78,\"hrv\":24}"
request POST /guides/generate "{\"user_id\":\"$USER_ID\",\"device_id\":\"$DEVICE_ID\",\"date\":\"$DATE\"}"
request GET "/guides/today?userId=$USER_ID&date=$DATE"
request POST /guides/notify "{\"date\":\"$DATE\"}"

IOT_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
IOT_PAYLOAD="{\"device_id\":\"$DEVICE_ID\",\"timestamp\":\"$IOT_TS\",\"pm25\":28,\"co2\":1180,\"temperature\":24.8,\"humidity\":61}"
printf '\n[smoke] Publishing IoT payload to health/sensor/%s/environment\n' "$DEVICE_ID"
aws iot-data publish \
  --endpoint-url "https://$IOT_ENDPOINT" \
  --topic "health/sensor/$DEVICE_ID/environment" \
  --cli-binary-format raw-in-base64-out \
  --payload "$IOT_PAYLOAD" \
  --region "$REGION"

sleep 3
printf '\n[smoke] Latest DynamoDB environment item after IoT publish\n'
aws dynamodb query \
  --table-name "$TABLE_NAME" \
  --key-condition-expression 'PK = :pk AND begins_with(SK, :sk)' \
  --expression-attribute-values "{\":pk\":{\"S\":\"DEVICE#$DEVICE_ID\"},\":sk\":{\"S\":\"ENV#\"}}" \
  --no-scan-index-forward \
  --limit 1 \
  --region "$REGION" \
  --output json | print_json

printf '\n[smoke] Complete\n'
