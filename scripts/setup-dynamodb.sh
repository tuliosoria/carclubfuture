#!/usr/bin/env bash
# Provision the carclubfuture single-table DynamoDB cache.
# Idempotent — safe to re-run.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
TABLE="${DYNAMODB_TABLE:-carclubfuture-cache}"

if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "✓ table $TABLE already exists in $REGION"
  exit 0
fi

echo "→ creating table $TABLE in $REGION"
aws dynamodb create-table \
  --region "$REGION" \
  --table-name "$TABLE" \
  --attribute-definitions \
      AttributeName=pk,AttributeType=S \
      AttributeName=sk,AttributeType=S \
  --key-schema \
      AttributeName=pk,KeyType=HASH \
      AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
echo "✓ table $TABLE ready"
