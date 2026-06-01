#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT_DIR/asthma-server"
BUILD_DIR="$APP_DIR/.aws-build/minimal-lambda"
ZIP_FILE="$APP_DIR/.aws-build/asthma-api-lambda.zip"
STATE_DIR="$ROOT_DIR/.omx/state"
STATE_FILE="$STATE_DIR/aws-minimal.env"

REGION="${AWS_REGION:-$(aws configure get region)}"
REGION="${REGION:-ap-northeast-2}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text --region "$REGION")"

TABLE_NAME="${TABLE_NAME:-AsthmaGuideData}"
FUNCTION_NAME="${FUNCTION_NAME:-cloud-iot-team4-asthma-api}"
ROLE_NAME="${ROLE_NAME:-cloud-iot-team4-lambda-role}"
API_NAME="${API_NAME:-cloud-iot-team4-asthma-http-api}"
IOT_RULE_NAME="${IOT_RULE_NAME:-cloud_iot_team4_environment_to_lambda}"
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-7}"
LAMBDA_RUNTIME="${LAMBDA_RUNTIME:-nodejs20.x}"
DEFAULT_USER_ID="${DEFAULT_USER_ID:-user_001}"
DEFAULT_DEVICE_ID="${DEFAULT_DEVICE_ID:-rpi_001}"
FITBIT_CLIENT_ID="${FITBIT_CLIENT_ID:-}"
FITBIT_CLIENT_SECRET="${FITBIT_CLIENT_SECRET:-}"
FITBIT_SCOPES="${FITBIT_SCOPES:-sleep heartrate oxygen_saturation respiratory_rate profile}"
FITBIT_STATE_SECRET="${FITBIT_STATE_SECRET:-}"
FITBIT_REDIRECT_URI="${FITBIT_REDIRECT_URI:-}"
USE_MOCK_DISCORD="${USE_MOCK_DISCORD:-true}"
DISCORD_WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"

TABLE_ARN="arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/$TABLE_NAME"
ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"
FUNCTION_ARN="arn:aws:lambda:$REGION:$ACCOUNT_ID:function:$FUNCTION_NAME"
LOG_GROUP="/aws/lambda/$FUNCTION_NAME"

log() { printf '\n[deploy] %s\n' "$*"; }

add_lambda_permission() {
  local statement_id="$1"
  local principal="$2"
  local source_arn="$3"
  local output
  if output="$(aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id "$statement_id" \
    --action lambda:InvokeFunction \
    --principal "$principal" \
    --source-arn "$source_arn" \
    --region "$REGION" 2>&1)"; then
    return 0
  fi
  if grep -q 'ResourceConflictException' <<<"$output"; then
    log "Lambda permission $statement_id already exists"
    return 0
  fi
  printf '%s\n' "$output" >&2
  return 1
}

exists_text() { [[ -n "${1:-}" && "${1:-}" != "None" ]]; }

write_lambda_env() {
  local output="$1"
  local redirect_uri="$2"
  TABLE_NAME="$TABLE_NAME" \
  DEFAULT_USER_ID="$DEFAULT_USER_ID" \
  DEFAULT_DEVICE_ID="$DEFAULT_DEVICE_ID" \
  FITBIT_CLIENT_ID="$FITBIT_CLIENT_ID" \
  FITBIT_CLIENT_SECRET="$FITBIT_CLIENT_SECRET" \
  FITBIT_REDIRECT_URI="$redirect_uri" \
  FITBIT_SCOPES="$FITBIT_SCOPES" \
  FITBIT_STATE_SECRET="$FITBIT_STATE_SECRET" \
  USE_MOCK_DISCORD="$USE_MOCK_DISCORD" \
  DISCORD_WEBHOOK_URL="$DISCORD_WEBHOOK_URL" \
  LAMBDA_ENV_FILE="$output" \
    python3 - <<'PY'
import json
import os

keys = [
    "TABLE_NAME",
    "DEFAULT_USER_ID",
    "DEFAULT_DEVICE_ID",
    "FITBIT_CLIENT_ID",
    "FITBIT_CLIENT_SECRET",
    "FITBIT_REDIRECT_URI",
    "FITBIT_SCOPES",
    "FITBIT_STATE_SECRET",
    "USE_MOCK_DISCORD",
    "DISCORD_WEBHOOK_URL",
]

with open(os.environ["LAMBDA_ENV_FILE"], "w", encoding="utf-8") as fp:
    json.dump({"Variables": {key: os.environ.get(key, "") for key in keys}}, fp)
PY
}

log "Using AWS account=$ACCOUNT_ID region=$REGION"

log "Ensuring DynamoDB table $TABLE_NAME"
if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" >/dev/null 2>&1; then
  log "DynamoDB table exists"
else
  aws dynamodb create-table \
    --table-name "$TABLE_NAME" \
    --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION" >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION"
fi

log "Ensuring IAM role $ROLE_NAME"
TRUST_POLICY="$APP_DIR/.aws-build/lambda-trust-policy.json"
mkdir -p "$(dirname "$TRUST_POLICY")"
cat > "$TRUST_POLICY" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON
if aws iam get-role --role-name "$ROLE_NAME" --region "$REGION" >/dev/null 2>&1; then
  log "IAM role exists"
else
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$TRUST_POLICY" \
    --description "cloud-iot-team-4 minimal Lambda execution role" \
    --tags Key=project,Value=cloud-iot-team-4 Key=purpose,Value=class-demo \
    --region "$REGION" >/dev/null
fi
aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
  --region "$REGION" >/dev/null

DDB_POLICY="$APP_DIR/.aws-build/lambda-dynamodb-policy.json"
cat > "$DDB_POLICY" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": "$TABLE_ARN"
    }
  ]
}
JSON
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name cloud-iot-team4-dynamodb-access \
  --policy-document "file://$DDB_POLICY" \
  --region "$REGION" >/dev/null

log "Packaging Lambda zip"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$(dirname "$ZIP_FILE")"
cp "$APP_DIR/lambda/index.mjs" "$BUILD_DIR/index.mjs"
(
  cd "$BUILD_DIR"
  zip -q -r "$ZIP_FILE" .
)

LAMBDA_ENV_FILE="$APP_DIR/.aws-build/lambda-env.json"
write_lambda_env "$LAMBDA_ENV_FILE" "$FITBIT_REDIRECT_URI"

log "Ensuring Lambda function $FUNCTION_NAME"
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$ZIP_FILE" \
    --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --runtime "$LAMBDA_RUNTIME" \
    --handler index.handler \
    --role "$ROLE_ARN" \
    --timeout 10 \
    --memory-size 128 \
    --environment "file://$LAMBDA_ENV_FILE" \
    --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
else
  # IAM role propagation can lag immediately after create-role/put-role-policy.
  sleep 10
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime "$LAMBDA_RUNTIME" \
    --architectures arm64 \
    --zip-file "fileb://$ZIP_FILE" \
    --handler index.handler \
    --role "$ROLE_ARN" \
    --timeout 10 \
    --memory-size 128 \
    --environment "file://$LAMBDA_ENV_FILE" \
    --tags project=cloud-iot-team-4,purpose=class-demo \
    --region "$REGION" >/dev/null
  aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
fi

log "Ensuring CloudWatch log group retention"
aws logs create-log-group --log-group-name "$LOG_GROUP" --region "$REGION" >/dev/null 2>&1 || true
aws logs put-retention-policy \
  --log-group-name "$LOG_GROUP" \
  --retention-in-days "$LOG_RETENTION_DAYS" \
  --region "$REGION" >/dev/null

log "Ensuring API Gateway HTTP API $API_NAME"
API_ID="$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)"
if ! exists_text "$API_ID"; then
  API_ID="$(aws apigatewayv2 create-api \
    --name "$API_NAME" \
    --protocol-type HTTP \
    --cors-configuration AllowOrigins='["*"]',AllowMethods='["GET","POST","OPTIONS"]',AllowHeaders='["content-type"]' \
    --tags project=cloud-iot-team-4,purpose=class-demo \
    --region "$REGION" \
    --query ApiId --output text)"
fi
API_ENDPOINT="https://$API_ID.execute-api.$REGION.amazonaws.com"

INTEGRATION_ID="$(aws apigatewayv2 get-integrations --api-id "$API_ID" --region "$REGION" --query "Items[?IntegrationUri=='$FUNCTION_ARN'].IntegrationId | [0]" --output text)"
if ! exists_text "$INTEGRATION_ID"; then
  INTEGRATION_ID="$(aws apigatewayv2 create-integration \
    --api-id "$API_ID" \
    --integration-type AWS_PROXY \
    --integration-uri "$FUNCTION_ARN" \
    --payload-format-version 2.0 \
    --region "$REGION" \
    --query IntegrationId --output text)"
fi

for ROUTE_KEY in \
  'GET /health' \
  'GET /auth/fitbit/login' \
  'GET /auth/fitbit/callback' \
  'POST /measurements/environment' \
  'POST /biometrics/fitbit' \
  'POST /biometrics/fitbit/notify' \
  'POST /google-health/fitbit/sync' \
  'POST /fitbit/sync' \
  'POST /guides/generate' \
  'POST /guides/notify' \
  'GET /guides/today'
do
  ROUTE_ID="$(aws apigatewayv2 get-routes --api-id "$API_ID" --region "$REGION" --query "Items[?RouteKey=='$ROUTE_KEY'].RouteId | [0]" --output text)"
  if exists_text "$ROUTE_ID"; then
    aws apigatewayv2 update-route \
      --api-id "$API_ID" \
      --route-id "$ROUTE_ID" \
      --target "integrations/$INTEGRATION_ID" \
      --region "$REGION" >/dev/null
  else
    aws apigatewayv2 create-route \
      --api-id "$API_ID" \
      --route-key "$ROUTE_KEY" \
      --target "integrations/$INTEGRATION_ID" \
      --region "$REGION" >/dev/null
  fi
done

EFFECTIVE_FITBIT_REDIRECT_URI="${FITBIT_REDIRECT_URI:-$API_ENDPOINT/auth/fitbit/callback}"
write_lambda_env "$LAMBDA_ENV_FILE" "$EFFECTIVE_FITBIT_REDIRECT_URI"
log "Updating Lambda environment with Fitbit callback $EFFECTIVE_FITBIT_REDIRECT_URI"
aws lambda update-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --environment "file://$LAMBDA_ENV_FILE" \
  --region "$REGION" >/dev/null
aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"

STAGE_NAME='$default'
STAGE_EXISTS="$(aws apigatewayv2 get-stages --api-id "$API_ID" --region "$REGION" --query "Items[?StageName=='$STAGE_NAME'].StageName | [0]" --output text)"
if exists_text "$STAGE_EXISTS"; then
  aws apigatewayv2 update-stage --api-id "$API_ID" --stage-name "$STAGE_NAME" --auto-deploy --region "$REGION" >/dev/null
else
  aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name "$STAGE_NAME" --auto-deploy --region "$REGION" >/dev/null
fi

log "Granting API Gateway invoke permission"
add_lambda_permission \
  "AllowInvokeFromHttpApi-$API_ID" \
  apigateway.amazonaws.com \
  "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*/*"

log "Ensuring IoT Core topic rule $IOT_RULE_NAME"
IOT_RULE_PAYLOAD="$APP_DIR/.aws-build/iot-topic-rule.json"
cat > "$IOT_RULE_PAYLOAD" <<JSON
{
  "sql": "SELECT *, topic(3) AS device_id FROM 'health/sensor/+/environment'",
  "awsIotSqlVersion": "2016-03-23",
  "ruleDisabled": false,
  "actions": [
    {
      "lambda": {
        "functionArn": "$FUNCTION_ARN"
      }
    }
  ]
}
JSON
if aws iot get-topic-rule --rule-name "$IOT_RULE_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws iot replace-topic-rule \
    --rule-name "$IOT_RULE_NAME" \
    --topic-rule-payload "file://$IOT_RULE_PAYLOAD" \
    --region "$REGION" >/dev/null
else
  aws iot create-topic-rule \
    --rule-name "$IOT_RULE_NAME" \
    --topic-rule-payload "file://$IOT_RULE_PAYLOAD" \
    --region "$REGION" >/dev/null
fi

log "Granting IoT Core invoke permission"
add_lambda_permission \
  "AllowInvokeFromIoTRule-$IOT_RULE_NAME" \
  iot.amazonaws.com \
  "arn:aws:iot:$REGION:$ACCOUNT_ID:rule/$IOT_RULE_NAME"

IOT_ENDPOINT="$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --region "$REGION" --query endpointAddress --output text)"

mkdir -p "$STATE_DIR"
cat > "$STATE_FILE" <<ENV
AWS_REGION=$REGION
AWS_ACCOUNT_ID=$ACCOUNT_ID
TABLE_NAME=$TABLE_NAME
FUNCTION_NAME=$FUNCTION_NAME
FUNCTION_ARN=$FUNCTION_ARN
ROLE_NAME=$ROLE_NAME
API_NAME=$API_NAME
API_ID=$API_ID
API_ENDPOINT=$API_ENDPOINT
FITBIT_REDIRECT_URI=$EFFECTIVE_FITBIT_REDIRECT_URI
IOT_RULE_NAME=$IOT_RULE_NAME
IOT_ENDPOINT=$IOT_ENDPOINT
LOG_GROUP=$LOG_GROUP
ENV

cat <<SUMMARY

Deployment complete.
State file: $STATE_FILE
API endpoint: $API_ENDPOINT
Fitbit callback URL: $EFFECTIVE_FITBIT_REDIRECT_URI
IoT data endpoint: $IOT_ENDPOINT
DynamoDB table: $TABLE_NAME
Lambda function: $FUNCTION_NAME
IoT rule: $IOT_RULE_NAME

Next smoke test:
  API_ENDPOINT="$API_ENDPOINT" IOT_ENDPOINT="$IOT_ENDPOINT" TABLE_NAME="$TABLE_NAME" AWS_REGION="$REGION" "$APP_DIR/scripts/smoke-aws-minimal.sh"
SUMMARY
