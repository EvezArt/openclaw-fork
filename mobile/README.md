# EVEZ Mobile Mesh

Galaxy A16 + Termux is the phone-side operator and sensor node. Linux is the compute/control node. Tailscale is the private transport. NextClaw remains the authoritative task plane. OpenClaw and Hermes are browser-accessed operator surfaces.

    Galaxy A16
      Android sensors / battery / Wi-Fi
      Bluetooth observations
      microphone + audio route
      guitar / interface / speakers / amp I/O
      Chrome
            |
         Tailscale
            |
            v
    Linux EVEZ node
      mobile relay :8788
      NextClaw :8787
      OpenClaw :18789
      Hermes : configured URL
      GitHub / EVEZ repos

The bridge is observation-first. It creates structured telemetry, hashes it, and submits it to the Linux relay. Raw microphone recordings stay local. The bridge sends audio metadata and SHA-256 hashes, not raw audio.

The audio layer treats the guitar, interface, speakers and amps as user-owned I/O. It can inspect Android audio routing and optionally capture short local clips. It does not implement RF jamming, spoofing, credential capture, device takeover, or interference with third-party communications.

## Android

Install Termux and the matching Termux:API add-on, then:

    pkg update
    pkg install -y curl jq python openssl coreutils
    pkg install -y termux-api
    termux-wake-lock

Copy mobile/termux/evez-mobile.env.example to $HOME/.config/evez-mobile.env. Replace the example tailnet host and EVEZ_RELAY_TOKEN with your actual values; never commit the real token. Generate a long random token, for example with openssl rand -hex 32, and use the same token in the Linux relay's private environment file. Protect the phone config with chmod 600 $HOME/.config/evez-mobile.env.

Then:

    bash mobile/termux/install.sh
    evezctl status
    evezctl mesh
    evezctl observe

Background service:

    pkg install -y termux-services
    mkdir -p $PREFIX/var/service/evez-mobile
    cp mobile/termux/service/evez-mobile/run $PREFIX/var/service/evez-mobile/run
    chmod +x $PREFIX/var/service/evez-mobile/run
    sv-enable evez-mobile
    sv status evez-mobile

## Linux

Create the relay's private environment file from mobile/linux/evez-mobile-relay.env.example at $HOME/.config/evez-mobile-relay.env, replace the placeholder token, and set mode 600. The systemd user service reads this file. Do not put the real token in the repository, command history, screenshots, or logs.

From the repository root, install the pinned RFC 8785 dependency in a virtual environment:

    python3 -m venv .venv
    .venv/bin/python -m pip install --require-hashes -r mobile/linux/requirements.txt

Run the relay with the same environment:

    .venv/bin/python mobile/linux/evez_mobile_relay.py

The systemd user unit expects this virtual environment at $HOME/evez/openclaw-fork/.venv; adjust WorkingDirectory and ExecStart in your local unit if your checkout lives elsewhere. It binds to 127.0.0.1:8788 by default. Expose it only to the tailnet with Tailscale Serve; keep the listener local and OpenClaw Gateway authentication enabled.

Observation digests use RFC 8785 JSON Canonicalization Scheme (JCS), declared as RFC8785_JCS in each envelope. The phone and relay use the same pinned implementation so hashes are reproducible across runtimes.

Fail-closed behavior: both observation and mission POSTs require Authorization: Bearer. If the relay has no configured token, writes return 503; a missing/wrong token returns 401. The relay rejects oversized/non-JSON requests and validates the SHA-256 digest of the canonical payload before storing an observation. The token is shared by the phone and relay; rotate it on suspected exposure.

## Operator commands

    evezctl status
    evezctl observe
    evezctl bluetooth
    evezctl audio
    evezctl mission "inspect the latest verified EVEZ state"
    evezctl openclaw
    evezctl hermes

`evezctl mesh` is a read-only phone-side reachability check. It checks the configured relay health endpoint (derived from `EVEZ_OBSERVATION_URL`), RuView health and nodes endpoints, and the OpenClaw/Hermes web surfaces using GET requests only. It prints status categories, not response bodies, URLs, or credentials. A 200 from RuView proves only that the API answered; it does not prove that a real CSI device is online. A 401/403 means the endpoint is reachable but requires authorization; 502/503/504 points to an upstream problem.

The mission path feeds the existing NextClaw gateway through the authenticated relay. The phone does not become the authoritative task database. Do not add arbitrary shell execution to the mission endpoint.

## Evidence

Each observation carries node_id, created_at, source, payload, digest and the NextClaw protocol identity. The Linux relay appends a hash-chained JSONL record. A digest detects payload mutation after generation; the chain detects edits relative to a trusted checkpoint. Neither proves that a sensor's measurement or its interpretation is true.

## Audio

Defaults are local-only:

    EVEZ_CAPTURE_AUDIO=false

When capture is explicitly enabled, the daemon records a short local clip and sends its hash plus metadata. Raw audio is not uploaded by this bridge. Keep audio capture opt-in and limited to your own equipment and authorized environments.
