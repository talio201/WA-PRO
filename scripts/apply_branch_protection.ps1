param(
  [string]$Owner = "talio201",
  [string]$Repo = "WA-PRO",
  [string]$Branch = "main"
)

$gh = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) {
  Write-Error "GitHub CLI not found at $gh"
  exit 1
}

& $gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "gh is not authenticated. Run: `"$gh`" auth login"
  exit 1
}

$body = @'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Security Gate / secrets-and-policy"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": true,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
'@

$endpoint = "repos/$Owner/$Repo/branches/$Branch/protection"
$tempFile = [System.IO.Path]::GetTempFileName()
Set-Content -Path $tempFile -Value $body -Encoding UTF8
& $gh api -X PUT $endpoint --input $tempFile
Remove-Item -Path $tempFile -Force -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) {
  Write-Error "Failed to apply branch protection"
  exit 1
}

Write-Output "Branch protection applied to ${Owner}/${Repo}:${Branch}"
