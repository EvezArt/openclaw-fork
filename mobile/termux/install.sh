#!/data/data/com.termux/files/usr/bin/bash
set -eo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BIN=$PREFIX/bin
CFG=$HOME/.config/evez-mobile.env

pkg update
pkg install -y curl jq python openssl

mkdir -p $HOME/.config
mkdir -p $HOME/.local/share/evez-mobile/audio
mkdir -p $PREFIX/var/service/evez-mobile

cp $ROOT/mobile/termux/evezctl $BIN/evezctl
cp $ROOT/mobile/termux/evez-mobile-daemon.sh $BIN/evez-mobile-daemon
cp $ROOT/mobile/termux/service/evez-mobile/run $PREFIX/var/service/evez-mobile/run

chmod +x $BIN/evezctl
chmod +x $BIN/evez-mobile-daemon
chmod +x $PREFIX/var/service/evez-mobile/run

if [ ! -f $CFG ]; then
  cp $ROOT/mobile/termux/evez-mobile.env.example $CFG
  echo "Created $CFG"
  echo "Edit it before starting the background service."
fi

echo "EVEZ mobile mesh installed."
