#!/usr/bin/env bash
#
# Create the PROD GitHub secrets and variables, in the order the deploy needs them.
#
#   bash infra/prod-secrets.sh status              # what exists, what is missing
#   bash infra/prod-secrets.sh deploy-sa           # gh-deploy-prod SA + GCP_SA_KEY_PROD
#   bash infra/prod-secrets.sh secrets             # every _PROD secret deploy.sh reads
#   bash infra/prod-secrets.sh webhook             # the real STRIPE_WEBHOOK_SECRET_PROD
#   bash infra/prod-secrets.sh vars <API_URL>      # the repo VARIABLES (public values)
#
# Everything here is idempotent: an existing secret is left alone unless you pass
# --force. Values are read from a prompt with echo off, or from the environment
# (e.g. STRIPE_SECRET_KEY_PROD=sk_live_… bash infra/prod-secrets.sh secrets), and
# are piped to `gh` on stdin — never as an argv the shell history keeps.
#
# WHY A SCRIPT AND NOT A CHECKLIST: `infra/deploy.sh` deploys with
# `--set-env-vars`, which REPLACES the service environment. A secret nobody set is
# not a failed deploy, it is a live service without it — an empty AUTH_JWT_SECRET
# throws on every sign AND every verify (nobody logs in, every session dies), and an
# empty STRIPE_WEBHOOK_SECRET means money in and no credits out. `deploy.sh` refuses
# a prod deploy missing any of the four that are unrecoverable; this script is how
# they come to exist.
#
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="${GCP_PROJECT_ID:-sinuous-canto-497518-h7}"
REGION="${GCP_LOCATION:-us-central1}"
DEPLOY_SA="gh-deploy-prod"
DEPLOY_SA_EMAIL="${DEPLOY_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
FORCE=0

for a in "$@"; do [[ "$a" == "--force" ]] && FORCE=1; done

die() { echo "!! $*" >&2; exit 1; }
note() { echo ">> $*"; }

command -v gh >/dev/null || die "gh (GitHub CLI) is not installed."
gh auth status >/dev/null 2>&1 || die "gh is not authenticated. Run: gh auth login"

existing_secrets() { gh secret list --json name -q '.[].name' 2>/dev/null; }
existing_vars() { gh variable list --json name -q '.[].name' 2>/dev/null; }
has_secret() { existing_secrets | grep -qx "$1"; }
has_var() { existing_vars | grep -qx "$1"; }

# Set one secret from stdin. Never echoes the value.
put_secret() {
  local name="$1" value="$2"
  [[ -n "$value" ]] || die "${name}: refusing to set an empty value (an empty secret is a silent outage, not an error)."
  printf '%s' "$value" | gh secret set "$name"
  note "${name} set (${#value} chars)."
}

# Prompt for a secret unless it already exists (or --force), validating the shape.
# $1 name  $2 human prompt  $3 required(1/0)  $4 regex the value must match ('' = any)
ask_secret() {
  local name="$1" prompt="$2" required="${3:-1}" pattern="${4:-}"
  if has_secret "$name" && [[ "$FORCE" -eq 0 ]]; then
    note "${name} already exists — skipping (re-run with --force to replace)."
    return 0
  fi
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    printf '   %s: ' "$prompt" >&2
    read -rs value < /dev/tty || true
    printf '\n' >&2
  fi
  if [[ -z "$value" ]]; then
    if [[ "$required" -eq 1 ]]; then
      die "${name} is required — deploy.sh refuses a prod deploy without it."
    fi
    note "${name} skipped (optional, left unset)."
    return 0
  fi
  if [[ -n "$pattern" && ! "$value" =~ $pattern ]]; then
    die "${name}: the value does not look right (expected /${pattern}/). Nothing was set."
  fi
  put_secret "$name" "$value"
}

# The Cloud Run URL suffix is derived from project + region, so prod's URL is dev's
# with the service name swapped. PREDICTED, not read: confirm it after the first
# deploy — the Stripe endpoint points at whatever this says.
predicted_api_url() {
  local dev
  dev="$(gcloud run services describe agent-researcher-dev-api --region "${REGION}" \
        --project "${PROJECT_ID}" --format='value(status.url)' 2>/dev/null || true)"
  [[ -n "$dev" ]] && echo "${dev/agent-researcher-dev-api/agent-researcher-prod-api}"
}

actual_api_url() {
  gcloud run services describe agent-researcher-prod-api --region "${REGION}" \
    --project "${PROJECT_ID}" --format='value(status.url)' 2>/dev/null || true
}

cmd_status() {
  echo "== secrets (name only — GitHub never returns a value) =="
  local secrets; secrets="$(existing_secrets)"
  for s in GCP_SA_KEY_PROD AUTH_JWT_SECRET_PROD STRIPE_SECRET_KEY_PROD \
           STRIPE_WEBHOOK_SECRET_PROD POSTMARK_SERVER_TOKEN_PROD \
           TURNSTILE_SECRET_PROD TAVILY_API_KEY_PROD BRAVE_API_KEY_PROD; do
    if grep -qx "$s" <<<"$secrets"; then echo "   [x] $s"; else echo "   [ ] $s"; fi
  done
  echo
  echo "== variables (public) =="
  local vars; vars="$(existing_vars)"
  for v in ADMIN_PROD_API_BASE_URL ADMIN_PROD_GOOGLE_CLIENT_ID \
           FBIZLAB_PROD_API_BASE_URL FBIZLAB_PROD_GOOGLE_CLIENT_ID \
           CORS_ORIGINS_PROD SEARCH_COST_PER_CALL_USD_PROD \
           BRAVE_COST_PER_CALL_USD_PROD MAX_JOB_COST_USD_PROD; do
    if grep -qx "$v" <<<"$vars"; then echo "   [x] $v"; else echo "   [ ] $v"; fi
  done
  echo
  echo "== Cloud Run =="
  local actual predicted
  actual="$(actual_api_url)"
  if [[ -n "$actual" ]]; then
    echo "   prod API is UP: ${actual}"
  else
    predicted="$(predicted_api_url)"
    echo "   prod API does not exist yet."
    [[ -n "$predicted" ]] && echo "   predicted URL (same project+region hash as dev): ${predicted}"
    [[ -z "$predicted" ]] && echo "   (could not read the dev URL — gcloud not authenticated for ${PROJECT_ID}?)"
  fi
}

cmd_deploy_sa() {
  command -v gcloud >/dev/null || die "gcloud is not installed."
  note "Project ${PROJECT_ID}, deploy SA ${DEPLOY_SA_EMAIL}"
  if gcloud iam service-accounts describe "${DEPLOY_SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    note "SA exists."
  else
    gcloud iam service-accounts create "${DEPLOY_SA}" --project "${PROJECT_ID}" \
      --display-name="GitHub deploy (prod)"
    note "SA created."
  fi
  # Owner, the same role gh-deploy-dev holds: the simplest one that can create
  # Firestore DBs, buckets, service accounts and IAM bindings. Narrow it later if
  # you prefer — but narrow BOTH, so dev keeps telling the truth about prod.
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${DEPLOY_SA_EMAIL}" --role="roles/owner" --condition=None >/dev/null
  note "roles/owner bound."

  if has_secret GCP_SA_KEY_PROD && [[ "$FORCE" -eq 0 ]]; then
    note "GCP_SA_KEY_PROD already exists — skipping key creation (--force to rotate)."
    return 0
  fi
  local tmp; tmp="$(mktemp -t gh-deploy-prod-key)"
  # The key file is the whole identity. It never leaves this shell: created,
  # piped to gh, and shredded on the way out (including if anything below fails).
  trap 'rm -f "$tmp"' EXIT
  gcloud iam service-accounts keys create "$tmp" --iam-account="${DEPLOY_SA_EMAIL}" --project "${PROJECT_ID}"
  gh secret set GCP_SA_KEY_PROD < "$tmp"
  rm -f "$tmp"; trap - EXIT
  note "GCP_SA_KEY_PROD set. The three prod workflows (API, admin SPA, fbizlab SPA) read it."
}

cmd_secrets() {
  note "Prompting only for what is missing. Nothing is echoed."

  # Generated, not asked: there is no reason for a human to choose 32 random bytes,
  # and a reused dev secret would make a dev token valid in prod.
  if has_secret AUTH_JWT_SECRET_PROD && [[ "$FORCE" -eq 0 ]]; then
    note "AUTH_JWT_SECRET_PROD already exists — skipping."
  else
    put_secret AUTH_JWT_SECRET_PROD "$(openssl rand -hex 32)"
    note "   (generated — distinct from dev's, so a dev session cannot sign into prod)"
  fi

  ask_secret STRIPE_SECRET_KEY_PROD \
    "Stripe LIVE secret key (sk_live_…)" 1 '^sk_live_'

  # The signing secret belongs to an endpoint that needs the API URL, which does not
  # exist until the first deploy — but deploy.sh refuses an empty one. Two ways out,
  # and the script offers the better one first.
  if has_secret STRIPE_WEBHOOK_SECRET_PROD && [[ "$FORCE" -eq 0 ]]; then
    note "STRIPE_WEBHOOK_SECRET_PROD already exists — skipping."
  else
    local predicted; predicted="$(predicted_api_url)"
    echo
    echo "   STRIPE_WEBHOOK_SECRET_PROD — create the endpoint in the Stripe LIVE dashboard:"
    echo "     URL:    ${predicted:-<prod API URL>}/credits/webhook"
    echo "     events: checkout.session.completed, checkout.session.async_payment_succeeded,"
    echo "             checkout.session.async_payment_failed, product.*, price.*"
    echo "   That URL is PREDICTED from dev's (same project+region hash). Confirm it after"
    echo "   the first deploy with: bash infra/prod-secrets.sh status"
    echo "   Leave blank to store a placeholder and come back with 'prod-secrets.sh webhook'."
    printf '   whsec_… (or blank): ' >&2
    local v=""; read -rs v < /dev/tty || true; printf '\n' >&2
    if [[ -z "$v" ]]; then
      put_secret STRIPE_WEBHOOK_SECRET_PROD "whsec_PLACEHOLDER_REPLACE_BEFORE_SELLING"
      echo "!! PLACEHOLDER STORED. Until you run 'prod-secrets.sh webhook', every purchase"  >&2
      echo "!! fails signature verification: money in, no credits out, and Stripe retries"   >&2
      echo "!! for days. Do it before the first buyer, not before the first deploy."         >&2
    elif [[ ! "$v" =~ ^whsec_ ]]; then
      die "That does not look like a signing secret (expected whsec_…). Nothing was set."
    else
      put_secret STRIPE_WEBHOOK_SECRET_PROD "$v"
    fi
  fi

  # One Postmark server token is shared across apps; the From address is per-app
  # (`emailFrom` on the app doc), so prod can reuse dev's token. GitHub never gives
  # a secret's value back, so it has to be pasted even when it is the same string.
  ask_secret POSTMARK_SERVER_TOKEN_PROD \
    "Postmark server token (the same one dev uses is fine)" 1 ''

  ask_secret TAVILY_API_KEY_PROD \
    "Tavily API key (optional — WITHOUT IT fetch_page fails, search falls back to DuckDuckGo)" 0 ''

  ask_secret BRAVE_API_KEY_PROD \
    "Brave API key (optional, blank to skip)" 0 ''
  if has_secret BRAVE_API_KEY_PROD; then
    echo "!! Brave is enabled. BRAVE_COST_PER_CALL_USD defaults to \$0, so every Brave" >&2
    echo "!! search is booked at zero until you set the variable:"                      >&2
    echo "!!   gh variable set BRAVE_COST_PER_CALL_USD_PROD --body 0.005"               >&2
  fi

  if has_secret TURNSTILE_SECRET_PROD; then
    note "TURNSTILE_SECRET_PROD already exists — the bot check will be ON in prod."
  else
    ask_secret TURNSTILE_SECRET_PROD "Cloudflare Turnstile secret (blank = bot check stays OFF)" 0 ''
  fi

  echo
  note "Done. Missing anything? bash infra/prod-secrets.sh status"
}

cmd_webhook() {
  local url; url="$(actual_api_url)"
  [[ -n "$url" ]] || die "The prod API is not deployed yet — there is no URL to point Stripe at."
  echo "   Endpoint to create/verify in the Stripe LIVE dashboard:"
  echo "     ${url}/credits/webhook"
  echo "     events: checkout.session.completed, checkout.session.async_payment_succeeded,"
  echo "             checkout.session.async_payment_failed, product.*, price.*"
  FORCE=1 ask_secret STRIPE_WEBHOOK_SECRET_PROD "Signing secret for THAT endpoint (whsec_…)" 1 '^whsec_'
  echo
  note "Redeploy so the API picks it up:"
  echo "   git commit --allow-empty -m 'chore: redeploy prod with the live webhook secret'"
  echo "   git push origin main:deploy-prod"
}

cmd_vars() {
  local api="${1:-}"
  [[ -n "$api" ]] || api="$(actual_api_url)"
  [[ -n "$api" ]] || die "Usage: prod-secrets.sh vars <API_URL>   (the prod API is not up, so I cannot read it)"
  api="${api%/}"

  local admin_site="${ADMIN_PROD_SITE_URL:-https://agent-researcher-prod-admin.web.app}"
  local fbizlab_site="${FBIZLAB_PROD_SITE_URL:-https://agent-researcher-prod-fbizlab.web.app}"

  gh variable set ADMIN_PROD_API_BASE_URL   --body "$api"
  gh variable set FBIZLAB_PROD_API_BASE_URL --body "$api"
  note "API base URL set for both SPAs: ${api}"

  # CORS: dev defaults to '*', prod should not. Both Hosting origins, nothing else —
  # localhost belongs in CORS_ORIGINS_DEV.
  gh variable set CORS_ORIGINS_PROD --body "${fbizlab_site},${admin_site}"
  note "CORS_ORIGINS_PROD = ${fbizlab_site},${admin_site}"

  # Explicit beats defaulted: these are read by deploy.yml and passed to the
  # service. Unset, the code defaults apply and a change to the doc changes nothing.
  gh variable set SEARCH_COST_PER_CALL_USD_PROD --body "${SEARCH_COST_PER_CALL_USD_PROD:-0.016}"
  gh variable set MAX_JOB_COST_USD_PROD         --body "${MAX_JOB_COST_USD_PROD:-20}"
  note "cost variables set (search \$${SEARCH_COST_PER_CALL_USD_PROD:-0.016}/call, per-job clamp \$${MAX_JOB_COST_USD_PROD:-20})"

  local acid="${ADMIN_PROD_GOOGLE_CLIENT_ID:-}" fcid="${FBIZLAB_PROD_GOOGLE_CLIENT_ID:-}"
  if [[ -n "$acid" ]]; then gh variable set ADMIN_PROD_GOOGLE_CLIENT_ID --body "$acid"; note "ADMIN_PROD_GOOGLE_CLIENT_ID set."; fi
  if [[ -n "$fcid" ]]; then gh variable set FBIZLAB_PROD_GOOGLE_CLIENT_ID --body "$fcid"; note "FBIZLAB_PROD_GOOGLE_CLIENT_ID set."; fi

  if [[ -z "$acid" || -z "$fcid" ]]; then
    echo
    echo "   Still to set — the OAuth client ids. Create two Web clients in the GCP console"
    echo "   with these authorized JavaScript origins, then:"
    echo "     ${admin_site}    -> gh variable set ADMIN_PROD_GOOGLE_CLIENT_ID   --body '<id>.apps.googleusercontent.com'"
    echo "     ${fbizlab_site}  -> gh variable set FBIZLAB_PROD_GOOGLE_CLIENT_ID --body '<id>.apps.googleusercontent.com'"
    echo "   Each id ALSO has to land on its app doc in the prod Firestore, or login fails"
    echo "   the audience check — see infra/seed-prod.sh."
  fi
}

case "${1:-status}" in
  status)    cmd_status ;;
  deploy-sa) cmd_deploy_sa ;;
  secrets)   cmd_secrets ;;
  webhook)   cmd_webhook ;;
  vars)      shift; cmd_vars "${1:-}" ;;
  *) die "Usage: prod-secrets.sh <status|deploy-sa|secrets|webhook|vars [API_URL]> [--force]" ;;
esac
