param([string]$BaseUrl="http://127.0.0.1:7676",[int]$IntervalSeconds=10,[string]$BearerToken=$env:E2E_OWNER_TOKEN)
New-Item -ItemType Directory -Force artifacts | Out-Null
while ($true) {
  $ts=(Get-Date).ToUniversalTime().ToString("o")
  try {
    $h=Invoke-WebRequest -UseBasicParsing "$BaseUrl/healthz" -TimeoutSec 5
    try { $u=Invoke-WebRequest -UseBasicParsing "$BaseUrl/mcp" -Method Post -Headers @{Accept="application/json, text/event-stream"} -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":9001,"method":"initialize","params":{}}' -TimeoutSec 5 } catch { $u=$_.Exception.Response }
    try { $a=Invoke-WebRequest -UseBasicParsing "$BaseUrl/mcp" -Method Post -Headers @{Authorization="Bearer $BearerToken";Accept="application/json, text/event-stream"} -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":9002,"method":"initialize","params":{}}' -TimeoutSec 5 } catch { $a=$_.Exception.Response }
    $us=[int]$u.StatusCode; $as=if($a){[int]$a.StatusCode}else{0}; $event=if(([int]$h.StatusCode -ne 200) -or ($us -ne 401) -or ($as -eq 401)){"bearer_auth_alert"}else{"mcp_monitor_ok"}
    $record=[ordered]@{ts=$ts;event=$event;healthStatus=[int]$h.StatusCode;unauthenticatedStatus=$us;authenticatedStatus=$as;url=$BaseUrl}
  } catch { $record=[ordered]@{ts=$ts;event="bearer_auth_alert";reason="request_error";error=$_.Exception.Message;url=$BaseUrl} }
  $json=$record|ConvertTo-Json -Compress; Add-Content artifacts/mcp-monitor.log $json; Write-Output $json; Start-Sleep -Seconds $IntervalSeconds
}
