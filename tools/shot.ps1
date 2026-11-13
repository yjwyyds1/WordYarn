param(
  [Parameter(Mandatory=$true)][string]$Url,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$W = 1440,
  [int]$H = 1000,
  [int]$Full = 0
)
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$extra = if ($Full -eq 1) { "--screenshot=$Out" } else { "--screenshot=$Out" }
& $edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 `
  --virtual-time-budget=5000 --window-size="$W,$H" --screenshot="$Out" $Url 2>&1 | Out-Null
Start-Sleep -Milliseconds 400
if (Test-Path $Out) { Write-Output "OK $Out $((Get-Item $Out).Length)" } else { Write-Output "FAIL $Out" }
