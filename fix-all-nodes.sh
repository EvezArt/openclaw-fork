#!/usr/bin/env bash
# OpenClaw node diagnostic — deliberately read-only and fail-closed.
set -Eeuo pipefail

GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
HEALTH_URL="http://127.0.0.1:${GATEWAY_PORT}/healthz"

printf '%s\n' '=== OpenClaw Node Diagnostic ==='
printf 'Gateway health endpoint: %s\n' "$HEALTH_URL"

if command -v openclaw >/dev/null 2>&1; then
  printf '%s\n' 'OpenClaw CLI detected.'
  openclaw gateway status 2>&1 || true
else
  printf '%s\n' 'OpenClaw CLI is not installed or is not on PATH.'
fi

if command -v docker >/dev/null 2>&1; then
  printf '%s\n' 'Matching containers:'
  docker ps --filter 'name=openclaw' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>&1 || true
fi

if curl --silent --show-error --fail --max-time 5 "$HEALTH_URL"; then
  printf '\n%s\n' 'Gateway health endpoint responded.'
else
  printf '\n%s\n' 'Gateway health endpoint did not respond.'
fi

cat <<'EOF'

Security posture:
- This script never approves device pairings.
- This script never changes gateway authentication.
- This script never restarts services or containers.

If gateway access is unavailable, restore it through an authenticated local console
or an SSH session, then validate the configured authentication and network binding.
EOF
