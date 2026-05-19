param(
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$Repo,
  [string]$Notes = "Viniper UI release."
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

python scripts/build_release.py --version $Version --repo $Repo --notes $Notes
python scripts/verify_release.py

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI not found. Install gh or upload dist/ViniperUI-v$Version.zip and dist/latest.json manually."
}

gh release create "v$Version" `
  "dist/ViniperUI-v$Version.zip" `
  "dist/latest.json" `
  "dist/ViniperUI-v$Version.zip.sha256" `
  --repo $Repo `
  --title "Viniper UI v$Version" `
  --notes $Notes

Write-Host "Published Viniper UI v$Version to $Repo"
