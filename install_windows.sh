#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-$PWD}"
WINEPREFIX="${WINEPREFIX:-$REPO_DIR/.wine-smartbis}"
cd "$REPO_DIR"

if ! command -v wine >/dev/null 2>&1; then
  echo "ERROR: Wine no está instalado" >&2
  exit 1
fi

LATEST="$(find dist-electron -maxdepth 1 -type f -iname '*.exe' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2- || true)"
if [ -z "$LATEST" ]; then
  echo "ERROR: no hay un .exe en dist-electron; ejecuta ./build_windows.sh primero" >&2
  exit 2
fi

export WINEPREFIX
export WINEARCH=win64
mkdir -p "$WINEPREFIX"

if command -v xvfb-run >/dev/null 2>&1; then
  WINE_CMD=(xvfb-run -a wine)
  WINEBOOT_CMD=(xvfb-run -a wineboot)
elif [ -z "${DISPLAY:-}" ]; then
  echo "ERROR: este VPS no tiene DISPLAY ni xvfb-run instalado" >&2
  echo "Instala xvfb para probar el instalador en modo headless: sudo apt-get install xvfb" >&2
  exit 3
else
  WINE_CMD=(wine)
  WINEBOOT_CMD=(wineboot)
fi

echo "Instalando: $LATEST"
echo "Prefijo Wine: $WINEPREFIX"
"${WINEBOOT_CMD[@]}" --init >/dev/null 2>&1 || true
"${WINE_CMD[@]}" "$LATEST" /S
echo "Instalación completada en $WINEPREFIX"