[CmdletBinding()]
param([ValidateRange(1,65535)][int]$Port = 8848, [switch]$OpenBrowser)

$ErrorActionPreference = 'Stop'
$url = "http://127.0.0.1:$Port/"
$browserJob = $null
function Test-StudyService {
    try {
        $data = Invoke-RestMethod -Uri ($url + 'api/study') -TimeoutSec 2
        $names = $data.PSObject.Properties.Name
        return ('reviewCount' -in $names -and 'position' -in $names -and 'due' -in $names -and 'words' -in $names)
    } catch {
        return $false
    }
}
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    if (Test-StudyService) {
        Write-Host "CET4 is already running: $url"
        if ($OpenBrowser) { Start-Process $url }
        return
    }
    if (-not (Test-Path './build-cet4/cet4')) {
        wsl -- env PATH=/usr/bin:/bin cmake -S . -B build-cet4 -G Ninja -DCMAKE_BUILD_TYPE=Release
        if ($LASTEXITCODE -ne 0) { throw 'CMake configure failed. See backend/README.md for dependencies.' }
    }
    wsl -- env PATH=/usr/bin:/bin cmake --build build-cet4
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    if ($OpenBrowser) {
        $browserJob = Start-Job -ArgumentList $url -ScriptBlock {
            param($Address)
            for ($i = 0; $i -lt 20; $i++) {
                try {
                    $data = Invoke-RestMethod -Uri ($Address + 'api/study') -TimeoutSec 1
                    if ('reviewCount' -in $data.PSObject.Properties.Name) {
                        Start-Process $Address
                        return
                    }
                } catch {}
                Start-Sleep -Milliseconds 250
            }
        }
    }
    wsl -- ./build-cet4/cet4 site ../var/study.sqlite "$Port"
    if ($LASTEXITCODE -ne 0 -and -not (Test-StudyService)) {
        throw "CET4 could not start on port $Port. Check for another service using that port."
    }
} finally {
    if ($browserJob) { Remove-Job -Job $browserJob -Force }
    Pop-Location
}
