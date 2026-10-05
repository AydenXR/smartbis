#!/bin/bash
set -euo pipefail

SOURCE_DIR="/var/www/smartbis/dist-electron"
TARGET_DIR="/var/www/html/updates"
LATEST_YML="${SOURCE_DIR}/latest.yml"

echo "=== Smartbis POS - Deploy de actualizacion ==="
echo "Origen: ${SOURCE_DIR}"
echo "Destino: ${TARGET_DIR}"
echo ""

if [ ! -f "${LATEST_YML}" ]; then
  echo "ERROR: No existe ${LATEST_YML}. Ejecuta npm run electron:dist primero."
  exit 1
fi

VERSION=$(grep -E '^version:' "${LATEST_YML}" | head -1 | sed 's/^version:[[:space:]]*//g' | tr -d "'" | tr -d '"')
if [ -z "${VERSION}" ]; then
  echo "ERROR: No se pudo extraer la version desde ${LATEST_YML}."
  exit 1
fi

EXE="${SOURCE_DIR}/Smartbis-POS-${VERSION}-Setup.exe"
BLOCKMAP="${SOURCE_DIR}/Smartbis-POS-${VERSION}-Setup.exe.blockmap"

if [ ! -f "${EXE}" ]; then
  echo "ERROR: No se encontro ${EXE}."
  exit 1
fi

echo "Version detectada: ${VERSION}"
echo ""
echo "Copiando archivos..."
cp -v "${EXE}" "${TARGET_DIR}/"
cp -v "${BLOCKMAP}" "${TARGET_DIR}/"
cp -v "${LATEST_YML}" "${TARGET_DIR}/"

echo ""
echo "Ajustando permisos (www-data:www-data 644)..."
chown -R www-data:www-data "${TARGET_DIR}/"
chmod 644 "${TARGET_DIR}"/*.exe "${TARGET_DIR}"/*.blockmap "${TARGET_DIR}"/*.yml 2>/dev/null || true

echo ""
echo "=== Deploy completado exitosamente ==="
echo "Archivos publicados en ${TARGET_DIR}:"
ls -lh "${TARGET_DIR}/"
echo ""
echo "Los clientes POS detectaran la nueva version v${VERSION} al abrir la aplicacion."
echo "Feed URL: https://updates.smartbis.ai/updates/latest.yml"
echo ""
echo "Flujo del cliente: abrir POS -> detecta v${VERSION} -> modal aparece o ir a piso #6 Actualizaciones -> Verificar -> Descargar -> Instalar y reiniciar."
