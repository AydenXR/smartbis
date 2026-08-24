#!/usr/bin/env bash
set -euo pipefail

# Usa el directorio actual como repo si no se define REPO_DIR
REPO_DIR="${REPO_DIR:-$PWD}"
cd "$REPO_DIR"

echo "Repo: $REPO_DIR"

echo "1) Actualizando repo (si hay git)..."
if [ -d .git ]; then
  git pull --rebase || true
fi

echo "2) Limpiando builds previos..."
rm -rf dist-electron/* 2>/dev/null || true
mkdir -p dist-electron assets

echo "3) Asegurando icono assets/icon.ico..."
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
    echo "ERROR: No ImageMagick ni Python+Pillow disponibles. Instala 'imagemagick' o 'python3' con Pillow."
    exit 2
  fi
fi

echo "4) Comprobando Wine (si Linux)..."
if command -v wine >/dev/null 2>&1; then
  echo "Wine detected: $(wine --version)"
else
  echo "WARNING: Wine no instalado. Si estás en Linux, electron-builder puede requerir Wine+nsis para crear NSIS .exe"
fi

echo "5) Instalando dependencias (npm ci)..."
npm ci

echo "6) Ejecutando build Windows..."
npm run electron:win

echo "7) Manteniendo sólo el último .exe en dist-electron..."
cd dist-electron
shopt -s nullglob 2>/dev/null || true
EXES=( *.exe )
if [ ${#EXES[@]} -eq 0 ]; then
  echo "No se generó ningún .exe. Revisa la salida de build."
  exit 3
fi
# conservar el más reciente por fecha de modificación
LATEST="$(ls -t *.exe | head -n1)"
echo "Último .exe: $LATEST"
for f in *.exe; do
  if [ "$f" != "$LATEST" ]; then rm -f "$f"; fi
done
echo "Resultado final: $(pwd)/$LATEST"
