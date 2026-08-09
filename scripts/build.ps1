$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "ZhaopinInviter-Extension"
$zip = Join-Path $dist "ZhaopinInviter-Extension.zip"

if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage | Out-Null

Copy-Item -LiteralPath (Join-Path $root "manifest.json") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $stage
Copy-Item -LiteralPath (Join-Path $root "src") -Destination $stage -Recurse
Copy-Item -LiteralPath (Join-Path $root "popup") -Destination $stage -Recurse
Copy-Item -LiteralPath (Join-Path $root "options") -Destination $stage -Recurse

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force
Write-Output "Built: $zip"
