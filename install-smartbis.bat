@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "BASE_URL=https://updates.smartbis.ai/updates"
set "OUT_DIR=%USERPROFILE%\Downloads\Smartbis POS"
set "LOG_FILE=%OUT_DIR%\smartbis-install.log"

mkdir "%OUT_DIR%" 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $baseUrl = '%BASE_URL%'; $outDir = '%OUT_DIR%'; $logFile = '%LOG_FILE%'; New-Item -ItemType Directory -Force -Path $outDir | Out-Null; $yml = (Invoke-WebRequest -Uri ($baseUrl + '/latest.yml') -UseBasicParsing).Content; $file = ([regex]::Match($yml, '(?m)^path:\s*(.+)$')).Groups[1].Value.Trim(); if ([string]::IsNullOrWhiteSpace($file)) { throw 'No se encontro la ruta del exe en latest.yml' }; $dest = Join-Path $outDir $file; Write-Host 'Descargando la ultima version...' ; Write-Host ('URL: ' + $baseUrl + '/' + $file); Invoke-WebRequest -Uri ($baseUrl + '/' + $file) -OutFile $dest -UseBasicParsing; Write-Host ('Guardado en: ' + $dest); Start-Process -FilePath $dest -Wait; if (Test-Path $dest) { Write-Host 'Instalacion completada.' } else { throw 'No se pudo abrir el instalador.' }" 

if errorlevel 1 (
    echo.
    echo ERROR: La instalacion automatica fallo.
    echo Revisa la conexion a internet o la URL del servidor.
    pause
    exit /b 1
)

exit /b 0
