#!/data/data/com.termux/files/usr/bin/bash
set -eo pipefail

CFG="$HOME/.config/evez-mobile.env"
if [ -f "$CFG" ]; then
  . "$CFG"
fi

NODE_ID="${EVEZ_NODE_ID:-evez-a16}"
INTERVAL="${EVEZ_INTERVAL_SECONDS:-30}"
AUDIO_SECONDS="${EVEZ_AUDIO_SECONDS:-8}"
CAPTURE_AUDIO="${EVEZ_CAPTURE_AUDIO:-false}"
DATA_DIR="${EVEZ_DATA_DIR:-$HOME/.local/share/evez-mobile}"
OBS_URL="${EVEZ_OBSERVATION_URL:-}"
RELAY_TOKEN="${EVEZ_RELAY_TOKEN:-}"

AUDIO_DIR="$DATA_DIR/audio"
mkdir -p "$DATA_DIR" "$AUDIO_DIR"

json_cmd() {
  cmd="$1"
  shift
  if command -v "$cmd" >/dev/null 2>&1; then
    timeout 8s "$cmd" "$@" 2>/dev/null || echo '{}'
  else
    echo '{}'
  fi
}

bluetooth_json() {
  if command -v termux-bluetooth-scaninfo >/dev/null 2>&1; then
    termux-bluetooth-scaninfo 2>/dev/null || echo '{"status":"unavailable"}'
  elif command -v termux-bluetooth-scan >/dev/null 2>&1; then
    termux-bluetooth-scan info 2>/dev/null || echo '{"status":"unavailable"}'
  else
    echo '{"status":"command_unavailable"}'
  fi
}

audio_json() {
  if command -v termux-audio-info >/dev/null 2>&1; then
    termux-audio-info 2>/dev/null || echo '{}'
  else
    echo '{}'
  fi
}

capture_audio() {
  [ "$CAPTURE_AUDIO" = "true" ] || return 0
  command -v termux-microphone-record >/dev/null 2>&1 || return 0

  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file="$AUDIO_DIR/$stamp.opus"

  if termux-microphone-record -f "$file" -l "$AUDIO_SECONDS" -e opus >/dev/null 2>&1; then
    python - "$file" <<'PY'
import hashlib, json, os, sys
path = sys.argv[1]
with open(path, "rb") as fh:
    digest = hashlib.sha256(fh.read()).hexdigest()
print(json.dumps({"path": path, "sha256": digest, "bytes": os.path.getsize(path)}, sort_keys=True))
PY
  fi
}

once() {
  created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  audio_meta=$(capture_audio || true)
  [ -n "$audio_meta" ] || audio_meta='{}'

  payload=$(jq -cn \
    --arg node "$NODE_ID" \
    --arg created "$created" \
    --argjson battery "$(json_cmd termux-battery-status)" \
    --argjson wifi "$(json_cmd termux-wifi-connectioninfo)" \
    --argjson sensors "$(json_cmd termux-sensor -n 1)" \
    --argjson audio "$(audio_json)" \
    --argjson bluetooth "$(bluetooth_json)" \
    --argjson audio_clip "$audio_meta" \
    '{
      node_id:$node,
      created_at:$created,
      source:"android-a16",
      battery:$battery,
      wifi:$wifi,
      sensors:$sensors,
      audio_route:$audio,
      bluetooth:$bluetooth,
      audio_clip:$audio_clip
    }')

  # Digest the parsed observation with the same RFC 8785 JCS implementation as the relay.
  digest=$(printf '%s' "$payload" | python -c 'import json,sys,rfc8785; sys.stdout.buffer.write(rfc8785.dumps(json.load(sys.stdin)))' | sha256sum | awk '{print $1}')
  prefix=$(printf '%s' "$digest" | cut -c1-16)

  envelope=$(jq -cn \
    --arg node "$NODE_ID" \
    --arg created "$created" \
    --arg digest "$digest" \
    --arg prefix "$prefix" \
    --argjson payload "$payload" \
    '{
      protocol:"nextclaw/1",
      canonicalization:"RFC8785_JCS",
      kind:"evidence",
      node_id:$node,
      message_id:("mobile:" + $node + ":" + $created + ":" + $prefix),
      created_at:$created,
      payload:$payload,
      digest:$digest,
      evidence_class:"mobile_observation"
    }')

  printf '%s\n' "$envelope" > "$DATA_DIR/last-observation.json"

  if [ -n "$OBS_URL" ] && command -v curl >/dev/null 2>&1; then
    if [ -z "$RELAY_TOKEN" ]; then
      echo "EVEZ_RELAY_TOKEN is required; observation kept local and not sent." >&2
    else
      curl -fsS --max-time 10 \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $RELAY_TOKEN" \
        --data "$envelope" \
        "$OBS_URL" >/dev/null || true
    fi
  fi

  printf '%s\n' "$envelope"
}

if [ "$#" -gt 0 ] && [ "$1" = "--once" ]; then
  once
  exit 0
fi

while true; do
  once || true
  sleep "$INTERVAL"
done
