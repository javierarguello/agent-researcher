#!/usr/bin/env bash
#
# Seed the PROD Firestore: the two app docs a first release cannot run without.
#
#   bash infra/seed-prod.sh --admin-emails "you@co.com" \
#     [--admin-google-client-id <id>.apps.googleusercontent.com] \
#     [--fbizlab-google-client-id <id>.apps.googleusercontent.com] \
#     [--email-from "FloridaBizLab <no-reply@floridabizlabs.com>"] \
#     [--web-url https://agent-researcher-prod-fbizlab.web.app] \
#     --confirm
#
# `npm run reset:dev` does this for dev and REFUSES any other ENV, so prod has
# never had an equivalent — its Firestore comes up empty and nothing fills it.
#
# Three things this gets right that a hand-typed session gets wrong:
#
#   1. SLUG DOC IDS. `apps seed-admin` mints a randomUUID appId, and both SPAs are
#      compiled against the slugs `admin` / `fbizlab` (VITE_ADMIN_APP_ID, VITE_APP_ID).
#      An admin app under a UUID looks fine in Firestore and cannot be logged into.
#   2. CREATE vs UPDATE. `createApp` writes with `.set()`, so running it twice on an
#      existing id REPLACES the doc — new apiKey, and every field this script does
#      not pass silently gone. So it checks first and updates instead.
#   3. `emailFrom` + `webUrl` on the buyer app. Without both, `POST /auth/register`
#      answers 500 (apps/api/src/index.ts:456): nobody can verify an email.
#
# Requires ADC with write access to the prod database:
#   gcloud auth application-default login
#
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_EMAILS=""
ADMIN_GCID=""
FBIZLAB_GCID=""
EMAIL_FROM=""
WEB_URL="https://agent-researcher-prod-fbizlab.web.app"
TEMPLATE="florida-business-for-sale"
CONFIRM=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-emails) ADMIN_EMAILS="$2"; shift 2 ;;
    --admin-google-client-id) ADMIN_GCID="$2"; shift 2 ;;
    --fbizlab-google-client-id) FBIZLAB_GCID="$2"; shift 2 ;;
    --email-from) EMAIL_FROM="$2"; shift 2 ;;
    --web-url) WEB_URL="$2"; shift 2 ;;
    --template) TEMPLATE="$2"; shift 2 ;;
    --confirm) CONFIRM=1; shift ;;
    *) echo "!! unknown flag: $1" >&2; exit 1 ;;
  esac
done

die() { echo "!! $*" >&2; exit 1; }
note() { echo ">> $*"; }

[[ -n "$ADMIN_EMAILS" ]] || die "--admin-emails is required: without it nobody can log into the admin."

# ENV on the command line beats anything in .env (verified: node's --env-file does
# not override the process environment), so this really does target prod.
export ENV=prod
DB="${FIRESTORE_DATABASE:-agent-researcher-prod}"

if [[ "$CONFIRM" -ne 1 ]]; then
  echo "This writes app docs to the PROD Firestore database '${DB}'."
  echo "Re-run with --confirm."
  exit 1
fi

apps_cli() { npm run --silent apps -- "$@"; }

# 'not found' is what `get` prints for a missing doc; anything else is a doc.
app_exists() { [[ "$(apps_cli get --appId "$1" 2>/dev/null || true)" != "not found" ]]; }

note "Target database: ${DB}"

# ---- admin app -------------------------------------------------------------
# Role admin + the email whitelist IS the authorization: /auth/session issues an
# admin token only for an address listed here (apps/api/src/index.ts:365).
if app_exists admin; then
  note "app 'admin' exists — updating (not recreating: .set() would mint a new apiKey)."
  apps_cli update --appId admin --admin-emails "$ADMIN_EMAILS" \
    ${ADMIN_GCID:+--google-client-id "$ADMIN_GCID"} >/dev/null
else
  note "creating app 'admin'…"
  apps_cli create --appId admin --name "Backoffice Admin" --role admin \
    --admin-emails "$ADMIN_EMAILS" ${ADMIN_GCID:+--google-client-id "$ADMIN_GCID"} >/dev/null
fi

# ---- fbizlab app -----------------------------------------------------------
: "${EMAIL_FROM:=FloridaBizLab <no-reply@floridabizlabs.com>}"
if app_exists fbizlab; then
  note "app 'fbizlab' exists — updating."
  apps_cli update --appId fbizlab --allowed-templates "$TEMPLATE" \
    --email-from "$EMAIL_FROM" --web-url "$WEB_URL" \
    ${FBIZLAB_GCID:+--google-client-id "$FBIZLAB_GCID"} >/dev/null
else
  note "creating app 'fbizlab'…"
  apps_cli create --appId fbizlab --name "FloridaBizLab" \
    --allowed-templates "$TEMPLATE" --email-from "$EMAIL_FROM" --web-url "$WEB_URL" \
    ${FBIZLAB_GCID:+--google-client-id "$FBIZLAB_GCID"} >/dev/null
fi

# ---- defaults --------------------------------------------------------------
# getSettings() falls back to these when the doc is absent, so this only makes the
# values visible and editable from the admin.
apps_cli settings set --app 100 --user 20 >/dev/null
note "settings/general written (100 reports/h per app, 20 per user)."

echo
note "Seeded. Current state:"
apps_cli list
echo
echo "   Still needed before a buyer can do anything:"
[[ -z "$ADMIN_GCID"   ]] && echo "     - admin   googleClientId  (apps update --appId admin --google-client-id …)"
[[ -z "$FBIZLAB_GCID" ]] && echo "     - fbizlab googleClientId  (apps update --appId fbizlab --google-client-id …)"
echo "     - the Stripe LIVE packs, from the admin's Pricing screen"
echo "     - the fbizlab SPA build, which is the LAST step (it bakes the catalog)"
echo
echo "   The emailFrom above must be a VERIFIED Postmark sender, or every account"
echo "   email fails at send time rather than at configuration time."
