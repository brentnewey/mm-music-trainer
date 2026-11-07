# Opens Mega Man Keys in Chrome, starting the Vite dev server first if it isn't up.
# Run with:  npm start      (or make a Windows shortcut to this file)
param(
  [int]$Port = 5173
)

$root = Split-Path -Parent $PSScriptRoot
$url = "http://localhost:$Port/"

function Test-DevServer {
  param([string]$Url)
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

if (Test-DevServer $url) {
  Write-Host "Dev server already up at $url"
} else {
  Write-Host "Starting dev server on port $Port ..."
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npm run dev -- --port $Port --strictPort" -WorkingDirectory $root -WindowStyle Minimized
  $ready = $false
  foreach ($i in 1..40) {
    Start-Sleep -Milliseconds 500
    if (Test-DevServer $url) { $ready = $true; break }
  }
  if (-not $ready) {
    Write-Host "Server did not answer within 20s - check the minimized 'npm run dev' window."
    exit 1
  }
  Write-Host "Dev server ready at $url"
}

$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (Test-Path $chrome) {
  Start-Process -FilePath $chrome -ArgumentList $url
} else {
  Start-Process $url
}
