#!/usr/bin/env bash
# Zips extension/ into dist/postcoverage-<version>.zip, ready to attach to a GitHub release.
set -euo pipefail

VERSION="$(python3 -c 'import json; print(json.load(open("extension/manifest.json"))["version"])')"
OUT="dist/postcoverage-${VERSION}.zip"

python3 build.py
mkdir -p dist
rm -f "$OUT"
(cd extension && zip -qr "../$OUT" . -x '.*')

echo "Wrote $OUT"
