#!/usr/bin/env bash
#
# Build + deploy ONE environment (dev | prod) of agent-researcher.
#   API    -> Cloud Run Service (public, scale-to-0)
#   Worker -> Cloud Run Service (private, concurrency=1, invoked by Cloud Tasks)
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
# Per-call search prices. Without these the job cost silently books searches at the
# code defaults, which is how "Brave traffic is billed at $0" survived a fix for it.
SEARCH_COST_PER_CALL_USD="${SEARCH_COST_PER_CALL_USD:-}"
BRAVE_COST_PER_CALL_USD="${BRAVE_COST_PER_CALL_USD:-}"
TAVILY_API_KEY="${TAVILY_API_KEY:-}"
# The research loop's per-turn caps. `docs/deployment.md` documents both as
# deployable and neither was in COMMON_ENV, so production ran the code defaults and
# a change to either did nothing (round 7, R7-31). Empty = the code default; Cloud
# Run drops an env var set to the empty string, which is what we want here.
LLM_GATHER_MAX_OUTPUT_TOKENS="${LLM_GATHER_MAX_OUTPUT_TOKENS:-}"
LLM_GATHER_THINKING_BUDGET="${LLM_GATHER_THINKING_BUDGET:-}"
# The per-job ceiling decides whether a job is HELD — credits spent, checkpoint kept,
# waiting on a human. It was documented as deployable and passed by nothing, which is
# the same defect R7-31 filed against the two above (round 8, R8-32).
MAX_JOB_COST_USD="${MAX_JOB_COST_USD:-}"
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-}"
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-}"
AUTH_JWT_SECRET="${AUTH_JWT_SECRET:-}"
POSTMARK_SERVER_TOKEN="${POSTMARK_SERVER_TOKEN:-}"
# Cloudflare Turnstile. Empty = the bot check stays off (fail-open by design), so
# a deploy without it behaves exactly as before.
TURNSTILE_SECRET="${TURNSTILE_SECRET:-}"
CORS_ORIGINS="${CORS_ORIGINS:-*}"

REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/agent-researcher"
API_IMAGE="${REPO}/api:${ENV}"
WORKER_IMAGE="${REPO}/worker:${ENV}"
API_SA_EMAIL="${PREFIX}-api@${PROJECT_ID}.iam.gserviceaccount.com"
WORKER_SA_EMAIL="${PREFIX}-worker@${PROJECT_ID}.iam.gserviceaccount.com"

# Env vars shared by API + worker.
#
# DELIMITED WITH '|', NOT ',' — and the flag value carries the `^|^` prefix that
# tells gcloud so. A comma-delimited list cannot express a value that CONTAINS a
# comma, and one of ours does: CORS_ORIGINS is "origin,origin" the moment a
# deployment serves more than one site. gcloud does not fail on the comma inside
# the value, it splits there and then rejects the half with no '=' in it:
#   ERROR: Bad syntax for dict arg: [https://…-admin.web.app]
# Measured on 2026-08-21, the first prod release: the worker (whose block has no
# CORS_ORIGINS) deployed, the API did not. Dev had never hit it because
# CORS_ORIGINS_DEV is unset and falls back to '*'.
ENV_SEP='|'
COMMON_ENV="ENV=${ENV}|GCP_PROJECT_ID=${PROJECT_ID}|GCP_LOCATION=${REGION}|RESEARCH_BUCKET=${BUCKET}|FIRESTORE_DATABASE=${DATABASE}|RESEARCH_MAX_TURNS=${MAX_TURNS}|BRAVE_API_KEY=${BRAVE_API_KEY}|TAVILY_API_KEY=${TAVILY_API_KEY}|SEARCH_COST_PER_CALL_USD=${SEARCH_COST_PER_CALL_USD}|BRAVE_COST_PER_CALL_USD=${BRAVE_COST_PER_CALL_USD}|POSTMARK_SERVER_TOKEN=${POSTMARK_SERVER_TOKEN}|LLM_GATHER_MAX_OUTPUT_TOKENS=${LLM_GATHER_MAX_OUTPUT_TOKENS}|LLM_GATHER_THINKING_BUDGET=${LLM_GATHER_THINKING_BUDGET}|MAX_JOB_COST_USD=${MAX_JOB_COST_USD}"

# The delimiter moved the problem, it did not remove it: a value containing '|'
# would now split the same way. Nothing we pass today can (URLs, hex secrets, sk_
# keys, decimals), so this is the guard that keeps that true — a loud failure
# before the deploy beats a service that comes up with half a value.
for _name in CORS_ORIGINS TAVILY_API_KEY BRAVE_API_KEY POSTMARK_SERVER_TOKEN \
             STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET AUTH_JWT_SECRET TURNSTILE_SECRET \
             SEARCH_COST_PER_CALL_USD BRAVE_COST_PER_CALL_USD MAX_JOB_COST_USD; do
  if [[ "${!_name}" == *"${ENV_SEP}"* ]]; then
    echo "!! ${_name} contains '${ENV_SEP}', which is the delimiter --set-env-vars is parsed with." >&2
    echo "!! Change the delimiter in infra/deploy.sh (and this list) rather than the value." >&2
    exit 1
  fi
done

# `--set-env-vars` REPLACES the service environment: a name absent from COMMON_ENV
# is deleted from the running service, not left alone. That makes a missing secret a
# silent outage rather than a failed deploy — an empty AUTH_JWT_SECRET throws on every
# sign AND every verify (nobody logs in, every live session dies), and an empty
# STRIPE_WEBHOOK_SECRET means a payment we already took can never grant credits
# (round 8, R8-1). Loud beats silent, and only for the env where it is unrecoverable.
if [[ "${ENV}" == "prod" ]]; then
  missing=()
  [[ -z "${AUTH_JWT_SECRET}" ]] && missing+=("AUTH_JWT_SECRET")
  [[ -z "${STRIPE_SECRET_KEY}" ]] && missing+=("STRIPE_SECRET_KEY")
  [[ -z "${STRIPE_WEBHOOK_SECRET}" ]] && missing+=("STRIPE_WEBHOOK_SECRET")
  [[ -z "${POSTMARK_SERVER_TOKEN}" ]] && missing+=("POSTMARK_SERVER_TOKEN")
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "!! [prod] refusing to deploy: ${missing[*]} would be ERASED from the live service." >&2
    echo "!! --set-env-vars replaces the environment; set these in the workflow, not on the service." >&2
    exit 1
  fi
fi

# --- The bucket cannot be made public, and every deploy re-asserts it ----------
#
# `publicAccessPrevention` was `inherited` on both buckets: nothing was public, no
# `allUsers` binding anywhere, uniform bucket-level access on. All true, and all of
# it a CURRENT FACT rather than a PROPERTY — one wrong binding, by a person or by a
# script, and reports a buyer paid for are on the open web. `enforced` is the
# difference between "nobody has done it" and "it cannot be done".
#
# Here rather than in `setup-gcp.sh` because setup runs once, by hand, when an
# environment is born; this runs on every release of both environments, so the
# property is re-asserted rather than remembered. It is also cheap: the describe
# short-circuits and no write happens once it is already enforced.
#
# FATAL, not a warning. A warning is what the previous version of this was — a line
# in a handoff saying it should be done — and it survived a launch that way.
echo ">> [${ENV}] Bucket gs://${BUCKET}: public access prevention..."
PAP="$(gcloud storage buckets describe "gs://${BUCKET}" --format="value(public_access_prevention)" 2>/dev/null || true)"
if [[ "${PAP}" == "enforced" ]]; then
  echo "   already enforced."
else
  if ! gcloud storage buckets update "gs://${BUCKET}" --public-access-prevention >/dev/null 2>&1; then
    echo "!! [${ENV}] refusing to deploy: gs://${BUCKET} has publicAccessPrevention='${PAP:-unknown}'," >&2
    echo "!! and this deploy could not set it. The deploy service account needs storage.buckets.update" >&2
    echo "!! (roles/storage.admin on the bucket is enough):" >&2
    echo "!!   gcloud storage buckets add-iam-policy-binding gs://${BUCKET} \\" >&2
    echo "!!     --member=serviceAccount:<the GCP_SA_KEY identity> --role=roles/storage.admin" >&2
    echo "!! Or set it once by hand: gcloud storage buckets update gs://${BUCKET} --public-access-prevention" >&2
    exit 1
  fi
  echo "   set to enforced."
fi

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
  --memory 2Gi --cpu 1 \
  --set-env-vars "^${ENV_SEP}^${COMMON_ENV}"

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
  --set-env-vars "^${ENV_SEP}^${COMMON_ENV}|WORKER_SERVICE_NAME=${WORKER_SERVICE}|WORKER_REGION=${REGION}|WORKER_SERVICE_URL=${WORKER_URL}|TASKS_QUEUE=${QUEUE}|TASKS_REGION=${REGION}|TASKS_INVOKER_SA=${API_SA_EMAIL}|JOB_MAX_CONCURRENCY=${JOB_MAX_CONCURRENCY}|STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}|STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}|AUTH_JWT_SECRET=${AUTH_JWT_SECRET}|TURNSTILE_SECRET=${TURNSTILE_SECRET}|CORS_ORIGINS=${CORS_ORIGINS}|APP_ENV=production"

echo ">> [${ENV}] Done."
gcloud run services describe "${API_SERVICE}" --region "${REGION}" --format='value(status.url)'
