#!/usr/bin/env bash
# Deploy SastiDawa to YOUR AWS account. Needs: AWS CLI v2, SAM CLI, configured credentials.
#   ./scripts/deploy.sh            (first run asks questions: stack name, region)
# Region default: ap-south-1 (Mumbai) - Textract is available there.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${STACK:-sastidawa}"
REGION="${AWS_REGION:-ap-south-1}"

echo "==> Running tests"
python3 -m unittest discover -s tests

echo "==> Building Lambda package"
rm -rf .build && mkdir -p .build/data
cp backend/*.py .build/
cp data/catalog.json data/kendras.json .build/data/

echo "==> Deploying stack '$STACK' to $REGION"
sam deploy --template-file infra/template.yaml --stack-name "$STACK" --region "$REGION" \
  --capabilities CAPABILITY_IAM --resolve-s3 --no-fail-on-empty-changeset

out() { aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET=$(out SiteBucketName); DIST=$(out DistributionId); URL=$(out AppUrl)

echo "==> Uploading website"
aws s3 sync frontend/ "s3://$BUCKET/" --delete --region "$REGION"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" >/dev/null

echo "==> Smoke test"
sleep 5
curl -fsS "$URL/api/health" && echo
echo
echo "Live at: $URL   (first CloudFront deploy can take ~5 min to go live)"
