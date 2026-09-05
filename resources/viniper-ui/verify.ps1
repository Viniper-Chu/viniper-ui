$ErrorActionPreference = 'Continue'
try {
    $s = Invoke-RestMethod 'http://127.0.0.1:17373/api/status' -TimeoutSec 6
    'runtime.status=' + $s.runtime.status
    'runtime.ready=' + $s.runtime.ready
    'runtime.detail=' + $s.runtime.detail
    'runtime.version=' + $s.runtime.version
    'claude_available=' + $s.claude_available
    'version=' + $s.version
    'ok=' + $s.ok
} catch {
    'STATUS_FAIL: ' + $_.Exception.Message
}
'--- TCP 17373 ---'
Get-NetTCPConnection -LocalPort 17373 -ErrorAction SilentlyContinue | Select-Object State,RemoteAddress,RemotePort,OwningProcess | Format-Table -AutoSize | Out-String
