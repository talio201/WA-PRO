param(
  [Parameter(Mandatory=$true)][string]$Host,
  [Parameter(Mandatory=$true)][string]$User,
  [Parameter(Mandatory=$true)][string]$KeyPath,
  [string]$RemotePath = "/opt/EmidiaWhats",
  [string]$Branch = "main"
)

if (-not (Test-Path $KeyPath)) {
  Write-Error "SSH key not found at: $KeyPath"
  exit 1
}

$sshCmd = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $sshCmd) {
  Write-Error "ssh command not found. Install OpenSSH client first."
  exit 1
}

$remoteScript = @"
set -e
cd $RemotePath
git fetch origin $Branch
git checkout $Branch
git pull --ff-only origin $Branch
docker compose down
docker compose up -d --build
docker compose ps
"@

ssh -i "$KeyPath" -o StrictHostKeyChecking=accept-new "$User@$Host" "$remoteScript"
if ($LASTEXITCODE -ne 0) {
  Write-Error "Terminal deploy failed"
  exit 1
}

Write-Output "Terminal deploy completed on $Host"
