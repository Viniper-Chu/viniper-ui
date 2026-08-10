param(
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$Repo,
  [string]$Notes = "Viniper release."
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

python scripts/build_release.py --version $Version --repo $Repo --notes $Notes
$UploadFiles = @(python scripts/verify_release.py --print-upload-files --require-windows-installer)
if ($LASTEXITCODE -ne 0) {
  throw "Release verification failed."
}
if ($UploadFiles.Count -lt 4) {
  throw "Verified upload set is incomplete."
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI not found. Install gh or upload dist/Viniper-v$Version.zip and dist/latest.json manually."
}

$GhArgs = @("release", "create", "v$Version") + $UploadFiles + @(
  "--repo", $Repo,
  "--title", "Viniper v$Version",
  "--notes", $Notes
)
& gh @GhArgs
if ($LASTEXITCODE -ne 0) {
  throw "GitHub release creation failed."
}

Write-Host "Published Viniper v$Version to $Repo"
