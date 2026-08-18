[CmdletBinding()]
param(
  [string]$BaseUrl = $(if ($env:MCP_MONITOR_BASE_URL) { $env:MCP_MONITOR_BASE_URL } else { "http://127.0.0.1:7676" }),
  [int]$IntervalSeconds = 60,
  [int]$Samples = 0,
  [string]$OutputPath = $(if ($env:MCP_MONITOR_OUTPUT) { $env:MCP_MONITOR_OUTPUT } else { "artifacts/mcp-monitor.log" }),
  [switch]$FailOnAlert
)

if (-not $env:MCP_MONITOR_BEARER_TOKEN) {
  Write-Error "MCP_MONITOR_BEARER_TOKEN must be supplied through the process environment; never pass it as a command-line argument."
  exit 2
}

$env:MCP_MONITOR_BASE_URL = $BaseUrl
$env:MCP_MONITOR_OUTPUT = $OutputPath
$env:MCP_MONITOR_INTERVAL_MS = [string]([Math]::Max(250, $IntervalSeconds * 1000))
$arguments = @("scripts/mcp-monitor.mjs", "--base-url", $BaseUrl, "--output", $OutputPath)
if ($Samples -gt 0) { $arguments += @("--samples", [string]$Samples) }
if ($FailOnAlert) { $arguments += "--fail-on-alert" }

& node @arguments
exit $LASTEXITCODE
