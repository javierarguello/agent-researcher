#!/usr/bin/env bash
#
# One-time GCP setup for ONE environment of agent-researcher. Idempotent-ish.
# All resources are suffixed with the environment (dev | prod) so the two
# environments never collide inside the shared GCP project.
#
#   ENV=dev  bash infra/setup-gcp.sh
#   ENV=prod bash infra/setup-gcp.sh
#
# Requires: gcloud (authenticated), project owner/editor rights.
#
set -euo pipefail

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
API_SA="${PREFIX}-api"
WORKER_SA="${PREFIX}-worker"
API_SA_EMAIL="${API_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
WORKER_SA_EMAIL="${WORKER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

echo ">> Environment: ${ENV}  Project: ${PROJECT_ID}  Region: ${REGION}"
gcloud config set project "${PROJECT_ID}"

echo ">> Enabling APIs..."
gcloud services enable \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  iam.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  cloudtasks.googleapis.com \
  iamcredentials.googleapis.com

echo ">> Artifact Registry repo (agent-researcher, shared across envs)..."
gcloud artifacts repositories create agent-researcher \
  --repository-format=docker --location="${REGION}" \
  --description="agent-researcher images" 2>/dev/null || echo "   (exists)"

echo ">> Firestore named database '${DATABASE}' (Native mode)..."
gcloud firestore databases create --database="${DATABASE}" \
  --location="${REGION}" --type=firestore-native 2>/dev/null || echo "   (exists)"

echo ">> Cloud Storage bucket gs://${BUCKET} ..."
gcloud storage buckets create "gs://${BUCKET}" \
  --location="${REGION}" --uniform-bucket-level-access 2>/dev/null || echo "   (exists)"

QUEUE="${PREFIX}-jobs"
JOB_MAX_CONCURRENCY="${JOB_MAX_CONCURRENCY:-4}"
echo ">> Cloud Tasks queue '${QUEUE}' (max ${JOB_MAX_CONCURRENCY} concurrent jobs)..."
gcloud tasks queues create "${QUEUE}" --location="${REGION}" 2>/dev/null || echo "   (exists)"
gcloud tasks queues update "${QUEUE}" --location="${REGION}" \
  --max-concurrent-dispatches="${JOB_MAX_CONCURRENCY}" \
  --max-dispatches-per-second=1 \
  --max-attempts=3 --min-backoff=10s --max-backoff=300s >/dev/null

echo ">> Service accounts..."
gcloud iam service-accounts create "${API_SA}" \
  --display-name="agent-researcher ${ENV} API" 2>/dev/null || echo "   (api SA exists)"
gcloud iam service-accounts create "${WORKER_SA}" \
  --display-name="agent-researcher ${ENV} worker" 2>/dev/null || echo "   (worker SA exists)"

echo ">> Worker SA roles (Vertex, Firestore, bucket, self-sign)..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${WORKER_SA_EMAIL}" --role="roles/aiplatform.user" --condition=None >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${WORKER_SA_EMAIL}" --role="roles/datastore.user" --condition=None >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${WORKER_SA_EMAIL}" --role="roles/storage.objectAdmin" >/dev/null
gcloud iam service-accounts add-iam-policy-binding "${WORKER_SA_EMAIL}" \
  --member="serviceAccount:${WORKER_SA_EMAIL}" --role="roles/iam.serviceAccountTokenCreator" >/dev/null

echo ">> API SA roles (Firestore, bucket read+sign, trigger worker job)..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${API_SA_EMAIL}" --role="roles/datastore.user" --condition=None >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${API_SA_EMAIL}" --role="roles/storage.objectViewer" >/dev/null
gcloud iam service-accounts add-iam-policy-binding "${API_SA_EMAIL}" \
  --member="serviceAccount:${API_SA_EMAIL}" --role="roles/iam.serviceAccountTokenCreator" >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${API_SA_EMAIL}" --role="roles/run.developer" --condition=None >/dev/null
gcloud iam service-accounts add-iam-policy-binding "${WORKER_SA_EMAIL}" \
  --member="serviceAccount:${API_SA_EMAIL}" --role="roles/iam.serviceAccountUser" >/dev/null

echo ">> API SA — Cloud Tasks enqueue + OIDC self-impersonation..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${API_SA_EMAIL}" --role="roles/cloudtasks.enqueuer" --condition=None >/dev/null
# The API SA mints an OIDC token as itself for the task → needs actAs on itself.
gcloud iam service-accounts add-iam-policy-binding "${API_SA_EMAIL}" \
  --member="serviceAccount:${API_SA_EMAIL}" --role="roles/iam.serviceAccountUser" >/dev/null

echo ">> Done (${ENV})."
echo "   Firestore DB: ${DATABASE}"
echo "   Bucket:       gs://${BUCKET}"
echo "   API SA:       ${API_SA_EMAIL}"
echo "   Worker SA:    ${WORKER_SA_EMAIL}"
