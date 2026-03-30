param(
  [string]$Branch = 'main'
)

$Tag = 'v2.0'
$CommitMsg = "chore: release $Tag - deploy from local"
$RemoteHost = 'root@144.126.214.121'
$RemotePort = 52088
$RemotePath = '/var/www/emidiawhats'

Write-Host '>>> Committing local changes'
if (Test-Path .git) {
  git add -A
  $status = git status --porcelain
  if ($status) {
    git commit -m $CommitMsg
  } else {
    Write-Host 'No changes to commit.'
  }
} else {
  Write-Error 'Not a git repository. Aborting.'; exit 1
}

Write-Host ">>> Pushing branch $Branch"
git push origin $Branch

# Tag
$tagExists = (git tag -l $Tag) -ne $null
if ($tagExists) {
  Write-Host "Tag $Tag already exists locally. Skipping tag creation."
} else {
  git tag -a $Tag -m $CommitMsg
  git push origin $Tag
}

Write-Host '>>> Deploying to remote (via SSH)'
$sshCommand = @"
set -e
if [ ! -d '$RemotePath' ]; then echo 'Remote path $RemotePath not found'; exit 1; fi
cd $RemotePath
git fetch --all --tags
git checkout $Branch
git reset --hard origin/$Branch
if [ -d backend ]; then
  cd backend
  if command -v npm >/dev/null 2>&1; then npm ci --production || true; fi
  cd ..
fi
if [ -d webapp ]; then
  cd webapp
  if command -v npm >/dev/null 2>&1; then npm ci || true; npm run build || true; fi
  cd ..
fi
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart all || pm2 reload all || true
elif [ -f docker-compose.yml ]; then
  docker-compose pull && docker-compose up -d --build || true
elif command -v systemctl >/dev/null 2>&1; then
  systemctl restart emidiawhats.service || true
else
  echo 'No known process manager found. Please restart services manually.'
fi
echo 'Deploy finished.'
"@

ssh -p $RemotePort $RemoteHost $sshCommand
Write-Host '>>> Done'
