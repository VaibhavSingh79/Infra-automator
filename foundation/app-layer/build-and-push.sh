#!/usr/bin/env bash
#
# Build the backend container (arm64) and push it to ECR.
# Run from the backend/ directory (where the Dockerfile is).
#
#   ../foundation/app-layer/build-and-push.sh <ecr_repo_url> [tag] [region]
#
set -euo pipefail

ECR_URL="${1:?Pass the ECR repo URL (terraform output ecr_repo_url)}"
TAG="${2:-latest}"
AWS_REGION="${3:-ap-south-1}"
REGISTRY="${ECR_URL%%/*}"

echo ">> Logging in to ECR: ${REGISTRY}"
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"

echo ">> Building + pushing arm64 image: ${ECR_URL}:${TAG}"
# --provenance=false / --sbom=false stop BuildKit from wrapping the image in a
# multi-entry manifest list with attestations, which AWS Lambda rejects. This
# produces a single-arch image manifest Lambda accepts. Build+push in one step.
docker buildx build \
  --platform linux/arm64 \
  --provenance=false \
  --sbom=false \
  -t "${ECR_URL}:${TAG}" \
  --push .

echo ">> Done. Update the Lambda to the new image:"
echo "   aws lambda update-function-code --function-name infraorchestrator-backend --image-uri ${ECR_URL}:${TAG} --region ${AWS_REGION}"