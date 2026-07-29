# Installs the already-built Robot Controller APK onto a Control Hub.
# No internet or gradle needed -- run this while joined to the hub's wifi.
#
#   powershell -ExecutionPolicy Bypass -File .\deploy-to-hub.ps1
#
# Pass -Usb if the laptop is plugged into the hub's USB-C port instead of its wifi.

param(
    [switch]$Usb
)

$ErrorActionPreference = 'Stop'

$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$apk = Join-Path $PSScriptRoot 'TeamCode\build\outputs\apk\debug\TeamCode-debug.apk'
$target = '192.168.43.1:5555'

if (-not (Test-Path $adb)) { throw "adb not found at $adb" }
if (-not (Test-Path $apk)) { throw "APK not found at $apk -- build it first with .\gradlew.bat :TeamCode:assembleDebug" }

Write-Host "APK: $apk" -ForegroundColor Cyan
Write-Host "     built $((Get-Item $apk).LastWriteTime)`n" -ForegroundColor Cyan

if (-not $Usb) {
    # A stale entry from a previous session shows up as "offline" and blocks the install.
    Write-Host 'Resetting adb and connecting over wifi...' -ForegroundColor Cyan
    & $adb disconnect $target | Out-Null
    & $adb kill-server   | Out-Null
    & $adb start-server  | Out-Null

    $connected = $false
    foreach ($attempt in 1..3) {
        $result = & $adb connect $target
        Write-Host "  attempt ${attempt}: $result"
        if ($result -match 'connected to') { $connected = $true; break }
        Start-Sleep -Seconds 2
    }

    if (-not $connected) {
        Write-Host "`nCould not reach the hub at $target." -ForegroundColor Red
        Write-Host 'Check that this laptop is joined to the Control Hub wifi network' -ForegroundColor Red
        Write-Host '(Driver Station -> menu -> Program & Manage shows the name and passphrase).' -ForegroundColor Red
        exit 1
    }
}

Write-Host "`nDevices:" -ForegroundColor Cyan
& $adb devices -l

# "offline" means adb sees the hub but the handshake never finished -- installing would fail.
$devices = (& $adb devices) | Select-String -Pattern '\sdevice$'
if (-not $devices) {
    Write-Host "`nNo device in 'device' state." -ForegroundColor Red
    Write-Host "If it says 'offline', reboot the hub and run this again." -ForegroundColor Red
    Write-Host "If it says 'unauthorized', accept the USB debugging prompt on the device." -ForegroundColor Red
    exit 1
}

Write-Host "`nInstalling (this takes a minute -- it's a 58 MB APK)..." -ForegroundColor Cyan
$output = & $adb install -r $apk 2>&1
$output | ForEach-Object { Write-Host "  $_" }

if ($output -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match') {
    Write-Host "`nThe existing Robot Controller was signed with a different key." -ForegroundColor Yellow
    Write-Host 'Uninstalling it and retrying. This wipes the saved hardware config.' -ForegroundColor Yellow
    & $adb uninstall com.qualcomm.ftcrobotcontroller
    $output = & $adb install -r $apk 2>&1
    $output | ForEach-Object { Write-Host "  $_" }
}

if ($output -match 'Success') {
    Write-Host "`nInstalled." -ForegroundColor Green
    Write-Host 'Next:'
    Write-Host '  1. Wait for the Driver Station to reconnect (~15s).'
    Write-Host '  2. Configure Robot -> add motors named fl, fr, bl, br -> save and activate.'
    Write-Host '  3. Open http://192.168.43.1:8080/dash and look for the bolt icon, top right.'
} else {
    Write-Host "`nInstall failed -- see the output above." -ForegroundColor Red
    exit 1
}
