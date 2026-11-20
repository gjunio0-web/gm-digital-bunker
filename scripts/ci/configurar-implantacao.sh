#!/usr/bin/env bash
# One-time setup, per Firebase project, of the deploy by GitHub Actions without a stored key (Workload Identity
# Federation). Run in Cloud Shell by an owner of the project:
#   bash scripts/ci/configurar-implantacao.sh gmdb-qualidade
#   bash scripts/ci/configurar-implantacao.sh gmdb-producao
# It creates the service account github-implantacao, grants it the deploy roles, creates the identity pool and
# provider accepted only for the repository gjunio0-web/gm-digital-bunker, and prints the two values to store as
# variables of the GitHub environment (qualidade or producao). Re-running skips what already exists.
set -euo pipefail

PROJETO="${1:?usage: configurar-implantacao.sh <project id>}"
REPO="gjunio0-web/gm-digital-bunker"
CONTA="github-implantacao"
POOL="github"
PROVEDOR="gm-digital-bunker"
EMAIL="${CONTA}@${PROJETO}.iam.gserviceaccount.com"
NUMERO="$(gcloud projects describe "$PROJETO" --format='value(projectNumber)')"

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project "$PROJETO"

gcloud iam service-accounts describe "$EMAIL" --project "$PROJETO" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$CONTA" --project "$PROJETO" --display-name "Implantação pelo GitHub Actions"

# Roles for deploying 2nd gen functions with triggers, schedules and secrets, and for the seed (Firestore write).
# Hypothesis to confirm on the first run: a missing permission makes the deploy fail naming it.
for papel in roles/cloudfunctions.admin roles/run.admin roles/eventarc.admin roles/cloudscheduler.admin \
  roles/artifactregistry.admin roles/secretmanager.viewer roles/iam.serviceAccountUser \
  roles/serviceusage.serviceUsageConsumer roles/firebase.viewer roles/datastore.user; do
  gcloud projects add-iam-policy-binding "$PROJETO" --member "serviceAccount:$EMAIL" --role "$papel" --condition None --quiet >/dev/null
done

gcloud iam workload-identity-pools describe "$POOL" --project "$PROJETO" --location global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "$POOL" --project "$PROJETO" --location global --display-name "GitHub"

gcloud iam workload-identity-pools providers describe "$PROVEDOR" --project "$PROJETO" --location global \
  --workload-identity-pool "$POOL" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc "$PROVEDOR" --project "$PROJETO" --location global \
    --workload-identity-pool "$POOL" --display-name "gm-digital-bunker" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition "assertion.repository == '${REPO}'"

gcloud iam service-accounts add-iam-policy-binding "$EMAIL" --project "$PROJETO" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${NUMERO}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" \
  --quiet >/dev/null

echo
echo "Variáveis do ambiente do GitHub para ${PROJETO}:"
echo "  WIF_PROVIDER = projects/${NUMERO}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVEDOR}"
echo "  CONTA_IMPLANTACAO = ${EMAIL}"
