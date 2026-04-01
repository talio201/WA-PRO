#!/usr/bin/env bash
set -euo pipefail

# Usage: ./deploy.sh [branch]
# Example: ./deploy.sh main

BRANCH="${1:-main}"
TAG="v2.0"
COMMIT_MSG="chore: release ${TAG} - deploy from local"

# Remote server settings - update if needed
REMOTE_USER_HOST="${REMOTE_USER_HOST:-root@<HOST>}"
REMOTE_PORT="${REMOTE_PORT:-<PORT>}"
REMOTE_PATH="/var/www/emidiawhats"

echo ">>> Committing local changes"
if git rev-parse --git-dir >/dev/null 2>&1; then
  git add -A
  if git diff --cached --quiet; then
    echo "No changes to commit."
  else
    git commit -m "$COMMIT_MSG"
  fi
else
  echo "Not a git repository. Aborting."
  exit 1
fi

echo ">>> Pushing branch $BRANCH"
git push origin "$BRANCH"

# Create and push tag (if not exists)
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists locally. Skipping tag creation."
else
  git tag -a "$TAG" -m "$COMMIT_MSG"
  git push origin "$TAG"
fi

echo ">>> Connecting to remote and deploying"
ssh -p ${REMOTE_PORT} ${REMOTE_USER_HOST} \
"bash -lc 'set -e; \
 if [ ! -d "${REMOTE_PATH}" ]; then echo "Remote path ${REMOTE_PATH} not found"; exit 1; fi; \
 cd ${REMOTE_PATH}; \
 echo "Fetching latest..."; git fetch --all --tags; \
 git checkout ${BRANCH}; \
 git reset --hard origin/${BRANCH}; \
 # Backend build
 if [ -d backend ]; then \
   cd backend; \
   if command -v npm >/dev/null 2>&1; then npm ci --production || true; fi; \
   cd ..; \
 fi; \
 # Webapp build
 if [ -d webapp ]; then \
   cd webapp; \
   if command -v npm >/dev/null 2>&1; then npm ci || true; npm run build || true; fi; \
   cd ..; \
 fi; \
 # Restart services (pm2, docker-compose or systemd)
 if command -v pm2 >/dev/null 2>&1; then \
   echo "Restarting pm2 apps..."; pm2 restart all || pm2 reload all || true; \
 elif [ -f docker-compose.yml ]; then \
   echo "Using docker-compose to rebuild..."; docker-compose pull && docker-compose up -d --build || true; \
 elif command -v systemctl >/dev/null 2>&1; then \
   echo "Attempting systemctl restart emidiawhats.service"; systemctl restart emidiawhats.service || true; \
 else \
   echo "No known process manager found. Please restart services manually."; \
 fi; \
 echo "Deploy finished."'
"

echo ">>> Done"
