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
    pkg install -y curl jq python openssl
    pkg install -y termux-api
    termux-wake-lock

Commands used when available:

    termux-battery-status
    termux-wifi-connectioninfo
    termux-sensor
    termux-audio-info
    termux-microphone-record
    termux-media-player
    Bluetooth scan command available in the installed API build

Copy mobile/termux/evez-mobile.env.example to:

    $HOME/.config/evez-mobile.env

Set the Linux tailnet URL and operator URLs, then:

    bash mobile/termux/install.sh
    evezctl status
    evezctl observe

Background service:

    pkg install -y termux-services
    mkdir -p $PREFIX/var/service/evez-mobile
    cp mobile/termux/service/evez-mobile/run $PREFIX/var/service/evez-mobile/run
    chmod +x $PREFIX/var/service/evez-mobile/run
    sv-enable evez-mobile
    sv status evez-mobile

## Linux

Run the relay:

    python3 mobile/linux/evez_mobile_relay.py

It binds to 127.0.0.1:8788 by default. Expose it only to the tailnet:

    tailscale serve 8788

OpenClaw's current browser Control UI is served by the Gateway on port 18789. Keep Gateway authentication enabled.

## Operator commands

    evezctl status
    evezctl observe
    evezctl bluetooth
    evezctl audio
    evezctl mission "inspect the latest verified EVEZ state"
    evezctl openclaw
    evezctl hermes

The mission path feeds the existing NextClaw gateway. The phone does not become the authoritative task database.

## Evidence

Each observation carries node_id, created_at, source, payload, digest and the NextClaw protocol identity. The Linux relay appends a hash-chained JSONL record.

An observation proves what the sensor pipeline recorded. It does not, by itself, prove the interpretation attached to that observation.

## Audio

Defaults are local-only:

    EVEZ_CAPTURE_AUDIO=false

When capture is enabled, the daemon records a short local clip and sends its hash plus metadata. Raw audio is not uploaded by this bridge.

This makes the same phone bridge useful for instrument practice, amp and speaker diagnostics, acoustic events, and time-correlated EVEZ telemetry without making continuous recording the default.
