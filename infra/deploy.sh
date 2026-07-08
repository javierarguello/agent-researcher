#!/usr/bin/env bash
#
# Build + deploy ONE environment (dev | prod) of agent-researcher.
#   API    -> Cloud Run Service (scale-to-0)
#   Worker -> Cloud Run Job (long task timeout)
# Run infra/setup-gcp.sh for the same ENV first.
#
#   ENV=dev  TAVILY_API_KEY=... bash infra/deploy.sh
#   ENV=prod TAVILY_API_KEY=... bash infra/deploy.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

ENV="${ENV:-dev}"
if [[ "${ENV}" != "dev" && "${ENV}" != "prod" ]]; then
  echo "ENV must be 'dev' or 'prod' (got '${ENV}')." >&2
  exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID:-sinuous-canto-497518-h7}"
REGION="${GCP_LOCATION:-us-central1}"
PREFIX="agent-researcher-${ENV}"

BUCKET="${RESEARCH_BUCKET:-${PREFIX}-reports}"
DATABASE="${FIRESTORE_DATABASE:-${PREFIX}}"
WORKER_SERVICE="${PREFIX}-worker"
QUEUE="${PREFIX}-jobs"
JOB_MAX_CONCURRENCY="${JOB_MAX_CONCURRENCY:-4}"
API_SERVICE="${PREFIX}-api"
MAX_TURNS="${RESEARCH_MAX_TURNS:-16}"
BRAVE_API_KEY="${BRAVE_API_KEY:-}"
TAVILY_API_KEY="${TAVILY_API_KEY:-}"

REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/agent-researcher"
API_IMAGE="${REPO}/api:${ENV}"
WORKER_IMAGE="${REPO}/worker:${ENV}"
API_SA_EMAIL="${PREFIX}-api@${PROJECT_ID}.iam.gserviceaccount.com"
WORKER_SA_EMAIL="${PREFIX}-worker@${PROJECT_ID}.iam.gserviceaccount.com"

# Env vars shared by API + worker (comma-delimited).
COMMON_ENV="ENV=${ENV},GCP_PROJECT_ID=${PROJECT_ID},GCP_LOCATION=${REGION},RESEARCH_BUCKET=${BUCKET},FIRESTORE_DATABASE=${DATABASE},RESEARCH_MAX_TURNS=${MAX_TURNS},BRAVE_API_KEY=${BRAVE_API_KEY},TAVILY_API_KEY=${TAVILY_API_KEY}"

echo ">> [${ENV}] Building worker image..."
gcloud builds submit --config infra/cloudbuild.worker.yaml \
  --substitutions "_IMAGE=${WORKER_IMAGE}" .

echo ">> [${ENV}] Deploying worker Cloud Run Service (${WORKER_SERVICE}, concurrency=1, private)..."
gcloud run deploy "${WORKER_SERVICE}" \
  --image "${WORKER_IMAGE}" \
  --region "${REGION}" \
  --service-account "${WORKER_SA_EMAIL}" \
  --no-allow-unauthenticated \
  --concurrency 1 \
  --timeout 1800 \
  --min-instances 0 --max-instances "${JOB_MAX_CONCURRENCY}" \
  --memory 1Gi --cpu 1 \
  --set-env-vars "${COMMON_ENV}"

WORKER_URL="$(gcloud run services describe "${WORKER_SERVICE}" --region "${REGION}" --format='value(status.url)')"
echo ">> [${ENV}] Worker URL: ${WORKER_URL}"

echo ">> [${ENV}] Granting API SA run.invoker on the worker service..."
gcloud run services add-iam-policy-binding "${WORKER_SERVICE}" --region "${REGION}" \
  --member="serviceAccount:${API_SA_EMAIL}" --role="roles/run.invoker" >/dev/null

echo ">> [${ENV}] Building API image..."
gcloud builds submit --config infra/cloudbuild.api.yaml \
  --substitutions "_IMAGE=${API_IMAGE}" .

echo ">> [${ENV}] Deploying API Cloud Run Service (${API_SERVICE}, scale-to-0)..."
gcloud run deploy "${API_SERVICE}" \
  --image "${API_IMAGE}" \
  --region "${REGION}" \
  --service-account "${API_SA_EMAIL}" \
  --min-instances 0 --max-instances 4 \
  --memory 512Mi --cpu 1 \
  --allow-unauthenticated \
  --set-env-vars "${COMMON_ENV},WORKER_SERVICE_NAME=${WORKER_SERVICE},WORKER_REGION=${REGION},WORKER_SERVICE_URL=${WORKER_URL},TASKS_QUEUE=${QUEUE},TASKS_REGION=${REGION},TASKS_INVOKER_SA=${API_SA_EMAIL},JOB_MAX_CONCURRENCY=${JOB_MAX_CONCURRENCY},APP_ENV=production"

echo ">> [${ENV}] Done."
gcloud run services describe "${API_SERVICE}" --region "${REGION}" --format='value(status.url)'
