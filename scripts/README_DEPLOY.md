# Scripts de Deploy

## Scripts Disponiveis

- `scripts/deploy.sh`: deploy shell para ambientes Linux.
- `scripts/deploy.ps1`: deploy em PowerShell.
- `deploy/remote_deploy.sh`: rotina remota para servidor alvo.

## Fluxo Recomendado

1. Build local e verificacao de erros.
2. Publicacao do backend.
3. Publicacao do webapp.
4. Restart controlado de servicos.
5. Smoke test de `/health`, `/usuarios` e API principal.
