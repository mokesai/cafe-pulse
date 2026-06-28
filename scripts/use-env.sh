#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_CHOICE="${1:-}"
NO_LINK="${2:-}"

if [[ -z "$ENV_CHOICE" ]]; then
  cat <<'EOF'
Usage: bash scripts/use-env.sh <sandbox|production> [--no-link]

Copies the matching ENV template into .env.local and runs `npx supabase link`
so Supabase migrations apply to the selected project.
EOF
  exit 1
fi

case "$ENV_CHOICE" in
  sandbox)
    TEMPLATE_PATH="$ROOT_DIR/../ENV_SANDBOX"
    LABEL="SANDBOX"
    ;;
  production|prod)
    TEMPLATE_PATH="$ROOT_DIR/../ENV_PROD"
    LABEL="PRODUCTION"
    ;;
  *)
    echo "Unknown environment '$ENV_CHOICE'. Use sandbox or production." >&2
    exit 1
    ;;
esac

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "Template file not found: $TEMPLATE_PATH" >&2
  exit 1
fi

DEST_PATH="$ROOT_DIR/.env.local"

if cmp -s "$TEMPLATE_PATH" "$DEST_PATH" 2>/dev/null; then
  echo ".env.local already matches $LABEL template."
else
  cp "$TEMPLATE_PATH" "$DEST_PATH"
  echo "Copied $LABEL settings into .env.local"
fi

PROJECT_REF="$(grep -E '^SUPABASE_PROJECT_REF=' "$DEST_PATH" | tail -n1 | cut -d '=' -f2- || true)"
if [[ -z "$PROJECT_REF" ]]; then
  echo "Warning: SUPABASE_PROJECT_REF missing from .env.local. Skipping supabase link." >&2
  exit 0
fi

if [[ "$NO_LINK" == "--no-link" ]]; then
  echo "Skipping Supabase link as requested."
  exit 0
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Warning: SUPABASE_ACCESS_TOKEN not set. Supabase CLI may prompt for auth." >&2
fi

echo "Linking Supabase project ($PROJECT_REF)..."
(cd "$ROOT_DIR" && supabase link --project-ref "$PROJECT_REF")
echo "Environment switched to $LABEL and Supabase link is updated."
