Deploy local -> production helper

Overview
- This folder contains helper scripts to commit, tag (v2.0) and deploy changes to your production server at root@144.126.214.121 (SSH port 52088).

Files
- `deploy.sh` : POSIX shell script for Linux/macOS/Git Bash/WSL.
- `deploy.ps1`: PowerShell script for Windows PowerShell/PowerShell Core.

How to use (safe checklist)
1. Review the scripts and adjust paths:
   - `REMOTE_PATH` in both scripts: default `/var/www/emidiawhats` — change to your site path.
   - Confirm `BRANCH` (default `main`) and `TAG` (default `v2.0`).

2. Run locally from repo root (make sure you have SSH access to the server):

POSIX (Git Bash / WSL / macOS / Linux):
```bash
# make script executable
chmod +x scripts/deploy.sh
# run (optionally pass branch)
./scripts/deploy.sh main
```

PowerShell (Windows):
```powershell
# run (may need to adjust ExecutionPolicy)
.
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.
scripts\deploy.ps1 -Branch main
```

3. What the script does
- Commits local changes (if any) with message `chore: release v2.0 - deploy from local`.
- Pushes branch and creates/pushes tag `v2.0` (if tag does not already exist).
- SSH into server, resets working directory to `origin/<branch>` and runs build steps:
  - `backend`: `npm ci --production` (if Node/npm exists)
  - `webapp`: `npm ci` + `npm run build` (if Node/npm exists)
- Attempts to restart services using `pm2`, `docker-compose`, or `systemctl` (in that order).

4. Rollback
- If deploy fails, use your backup or `git` to checkout a previous tag/commit on the server and rebuild.

Notes & Warnings
- The scripts assume the repo on the server is the same repository and located in `REMOTE_PATH`.
- Ensure SSH keys are configured (or you'll be prompted for a password).
- Test in a staging environment before production.
- I cannot run these scripts against your server from here; run them locally in your environment.

If you want, I can:
- Customize `REMOTE_PATH`, branch, service names for your server and update the scripts.
- Generate a one-line command to run that includes your branch and tag.
- Walk you through running the script and verify logs.
