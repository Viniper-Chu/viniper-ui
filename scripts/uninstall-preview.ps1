param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\Viniper workstation Preview'),
  [string]$DesktopRoot = ([Environment]::GetFolderPath('Desktop')),
  [switch]$AllowTestRoot,
  [switch]$SkipShortcut
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-AllowedInstallRoot([string]$Path, [bool]$TestRoot) {
  $full = [IO.Path]::GetFullPath($Path)
  $default = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\Viniper workstation Preview'))
  if ($full -ieq $default) { return $full }
  $parentName = Split-Path (Split-Path $full -Parent) -Leaf
  if ($TestRoot -and $parentName -eq '运行残留') { return $full }
  throw "拒绝移除非正式 Viniper workstation 安装目录：$full"
}

$target = Assert-AllowedInstallRoot $InstallRoot $AllowTestRoot
$shortcutPath = Join-Path $DesktopRoot 'Viniper workstation.lnk'

if (-not $SkipShortcut -and (Test-Path -LiteralPath $shortcutPath)) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $expectedTarget = [IO.Path]::GetFullPath((Join-Path $target 'Viniper workstation.exe'))
  if ([IO.Path]::GetFullPath($shortcut.TargetPath) -ieq $expectedTarget) {
    Remove-Item -LiteralPath $shortcutPath -Force
  }
}

if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
}

[pscustomobject]@{
  status = 'PROGRAM_REMOVED_USER_DATA_PRESERVED'
  installRoot = $target
  desktopShortcutRemoved = (-not (Test-Path -LiteralPath $shortcutPath))
  note = '仅移除正式安装目录和指向它的产品快捷方式；AppData\Roaming\Viniper workstation Preview 用户数据根不删除。'
} | ConvertTo-Json -Compress
