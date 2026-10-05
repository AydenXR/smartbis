#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="${REPO_DIR:-$PWD}"
cd "$REPO_DIR"
echo "Repo: $REPO_DIR"
if [ -d .git ]; then git pull --rebase || true; fi
rm -rf dist-electron/* 2>/dev/null || true
mkdir -p dist-electron assets
if [ ! -f assets/icon.ico ]; then
  if command -v magick >/dev/null 2>&1; then
    magick convert src/assets/logosb.png -resize 256x256 assets/icon.ico
  elif command -v convert >/dev/null 2>&1; then
    convert src/assets/logosb.png -resize 256x256 assets/icon.ico
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
from PIL import Image
img = Image.open("src/assets/logosb.png").convert("RGBA")
img.save("assets/icon.ico")
print("icon created")
PY
  else
    echo "ERROR: instala ImageMagick o Python3+Pillow y vuelve a ejecutar"
    exit 2
  fi
fi
if command -v wine >/dev/null 2>&1; then echo "Wine: $(wine --version)"; else echo "WARNING: Wine no instalado; NSIS .exe puede fallar en Linux"; fi
npm ci
npm run electron:win
cd dist-electron || exit 0
shopt -s nullglob 2>/dev/null || true
LATEST="$(ls -t *.exe 2>/dev/null | head -n1 || true)"
if [ -z "$LATEST" ]; then echo 'No .exe generado'; exit 3; fi
for f in *.exe; do if [ "$f" != "$LATEST" ]; then rm -f "$f"; fi; done
echo "Resultado final: $(pwd)/$LATEST"
