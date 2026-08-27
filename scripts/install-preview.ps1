param(
  [Parameter(Mandatory = $true)]
  [string]$Payload,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\Viniper workstation Preview'),
  [string]$DesktopRoot = ([Environment]::GetFolderPath('Desktop')),
  [switch]$AllowTestRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-AllowedInstallRoot([string]$Path, [bool]$TestRoot) {
  $full = [IO.Path]::GetFullPath($Path)
  $default = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\Viniper workstation Preview'))
  if ($full -ieq $default) { return $full }
  $parentName = Split-Path (Split-Path $full -Parent) -Leaf
  if ($TestRoot -and $parentName -eq '运行残留') { return $full }
  throw "拒绝写入非正式 Viniper workstation 安装目录：$full"
}

$target = Assert-AllowedInstallRoot $InstallRoot $AllowTestRoot
$payloadPath = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Payload).Path)
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("viniper-workstation-preview-" + [Guid]::NewGuid().ToString('N'))
$portableRoot = Join-Path $tempRoot 'Viniper-workstation-win32-x64'

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
  Expand-Archive -LiteralPath $payloadPath -DestinationPath $tempRoot -Force
  if (-not (Test-Path -LiteralPath (Join-Path $portableRoot 'Viniper workstation.exe'))) {
    throw '安装包缺少 Viniper workstation.exe。'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $portableRoot 'resources\app\package.json'))) {
    throw '安装包缺少 resources\app 自包含应用。'
  }
  $brandingRoot = Join-Path $portableRoot 'resources\app\assets\branding'
  $brandingManifestPath = Join-Path $brandingRoot 'manifest.json'
  if (-not (Test-Path -LiteralPath $brandingManifestPath)) {
    throw '安装包缺少品牌 manifest。'
  }
  $brandingManifest = Get-Content -LiteralPath $brandingManifestPath -Raw | ConvertFrom-Json
  $windowsIconName = [IO.Path]::GetFileName([string]$brandingManifest.windowsIco)
  if ([string]::IsNullOrWhiteSpace($windowsIconName) -or $windowsIconName -ne [string]$brandingManifest.windowsIco) {
    throw '品牌 manifest 的 Windows 图标必须是 assets/branding 下的文件名。'
  }
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  Copy-Item -Path (Join-Path $portableRoot '*') -Destination $target -Recurse -Force

  New-Item -ItemType Directory -Path $DesktopRoot -Force | Out-Null
  $shortcutPath = Join-Path $DesktopRoot 'Viniper workstation.lnk'
  if (Test-Path -LiteralPath $shortcutPath) {
    Remove-Item -LiteralPath $shortcutPath -Force
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $target 'Viniper workstation.exe'
  $shortcut.WorkingDirectory = $target
  $shortcut.IconLocation = Join-Path (Join-Path $target 'resources\app\assets\branding') $windowsIconName
  $shortcut.Description = 'Viniper workstation Preview'
  $shortcut.Save()

  [pscustomobject]@{
    status = 'INSTALLED_FOR_USER_EVALUATION'
    installRoot = $target
    shortcut = $shortcutPath
    userDataPolicy = '程序文件与用户数据根分离；重装不删除用户数据。'
    services = $false
    scheduledTasks = $false
    startup = $false
    fileAssociations = $false
  } | ConvertTo-Json -Compress
}
finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
