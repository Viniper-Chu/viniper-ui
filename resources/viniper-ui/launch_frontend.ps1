$ErrorActionPreference = 'Continue'
$exe = 'D:\Viniper\Viniper.exe'
if (Test-Path $exe) {
    Start-Process $exe
    Start-Sleep -Seconds 4
    'launched: ' + $exe
    '--- Viniper processes ---'
    Get-Process -Name 'Viniper' -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,@{n='MEM_MB';e={[int]($_.WorkingSet64/1MB)}} | Format-Table -AutoSize | Out-String
} else {
    'NOT FOUND: ' + $exe
    '--- D:\Viniper *.exe ---'
    Get-ChildItem 'D:\Viniper\' -Filter '*.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
}
