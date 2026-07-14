#!/usr/bin/env bash
#
# Build + deploy the admin SPA (apps/admin) to Firebase Hosting.
# Static site, no server — it talks to the API directly.
#
# ONE-TIME SETUP (run locally as the owner account miltonjaviera@gmail.com):
#   firebase login
#   firebase hosting:sites:create agent-researcher-dev-admin  --project sinuous-canto-497518-h7  # dev
#   firebase hosting:sites:create agent-researcher-prod-admin --project sinuous-canto-497518-h7  # prod (later)
#   # both targets (admin-dev / admin-prod) are mapped in apps/admin/.firebaserc
#
# Requires the build-time config in the environment:
#   VITE_API_BASE_URL           the API's public URL (Cloud Run), no trailing slash
#   VITE_ADMIN_GOOGLE_CLIENT_ID the admin app's Google OAuth client id
#   ADMIN_HOSTING_TARGET        admin-dev (default) | admin-prod
#
#   VITE_API_BASE_URL=https://…run.app VITE_ADMIN_GOOGLE_CLIENT_ID=…apps.googleusercontent.com \
#     bash infra/deploy-admin.sh
#
set -euo pipefail
cd "$(dirname "$0")/../apps/admin"

: "${VITE_API_BASE_URL:?set VITE_API_BASE_URL (the API's public URL, no trailing slash)}"
: "${VITE_ADMIN_GOOGLE_CLIENT_ID:?set VITE_ADMIN_GOOGLE_CLIENT_ID}"
PROJECT="${FIREBASE_PROJECT:-sinuous-canto-497518-h7}"
TARGET="${ADMIN_HOSTING_TARGET:-admin-dev}"

echo ">> Building admin SPA (API=${VITE_API_BASE_URL})..."
npm run build

echo ">> Deploying to Firebase Hosting (target: ${TARGET}, project: ${PROJECT})..."
firebase deploy --only "hosting:${TARGET}" --project "${PROJECT}"

echo ">> Done. Remember: the admin app doc's googleClientId must match, the login"
echo "   email must be in its adminEmails, and CORS_ORIGINS must allow this origin."
