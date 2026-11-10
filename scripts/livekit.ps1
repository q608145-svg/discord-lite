# Запускает локальный LiveKit на Windows (без Docker).
# Использование:  powershell -ExecutionPolicy Bypass -File scripts\livekit.ps1
# Оставьте это окно открытым — сервер голоса должен работать, пока вы в канале.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root "tools\livekit\livekit-server.exe"
$config = Join-Path $root "infra\livekit.local.yaml"

if (-not (Test-Path $bin)) {
    Write-Host "LiveKit не найден: $bin" -ForegroundColor Red
    Write-Host "Скачайте архив livekit_*_windows_amd64.zip с https://github.com/livekit/livekit/releases"
    Write-Host "и распакуйте livekit-server.exe в tools\livekit\"
    exit 1
}

Write-Host "LiveKit → ws://localhost:7880 (Ctrl+C, чтобы остановить)" -ForegroundColor Cyan
& $bin --config $config
