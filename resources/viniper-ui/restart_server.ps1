$ErrorActionPreference = 'Continue'
$py = 'C:\Users\13968\AppData\Local\Programs\Python\Python313\python.exe'
$wd = 'D:\Viniper\resources\viniper-ui'
$out = Join-Path $wd 'server_out.log'
$err = Join-Path $wd 'server_err.log'
Remove-Item $out, $err -ErrorAction SilentlyContinue
Start-Process -FilePath $py -ArgumentList 'server.py' -WorkingDirectory $wd -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Minimized
Start-Sleep -Seconds 4
try {
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:17373/api/status' -TimeoutSec 5
    'STATUS_OK: ' + ($status | ConvertTo-Json -Compress)
} catch {
    'STATUS_FAIL: ' + $_.Exception.Message
}
'--- server_err.log (tail) ---'
if (Test-Path $err) { Get-Content $err -Tail 20 }
'--- server_out.log (tail) ---'
if (Test-Path $out) { Get-Content $out -Tail 20 }
