# 🔐 Configurar GitHub Secrets para Auto-Deploy

O GitHub Actions precisa de **3 secrets** para fazer deploy automático no seu servidor. Siga este guia:

---

## ✅ Passo 1: Preparar suas credenciais SSH

Você precisa ter um **par de chaves SSH** (privada + pública) para acesso SSH ao servidor.

### Se você já tem chaves SSH:
```bash
# Ver sua chave privada
cat ~/.ssh/id_ed25519    # ou id_rsa para RSA keys

# Copie TODO o conteúdo (incluindo -----BEGIN... até -----END...)
```

### Se NÃO tem chaves SSH ainda:
```bash
# Gerar nova chave (sem passphrase!)
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""

# OU para RSA (menor compatibilidade):
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""

# Ver a chave privada
cat ~/.ssh/id_ed25519  # copie tudo, incluindo headers
```

### Adicionar chave pública no servidor:
```bash
# No SERVIDOR (via SSH manual ou console):
mkdir -p ~/.ssh
echo "COLAR_AQUI_CONTEUDO_DE_id_ed25519.pub" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh

# Testar acesso:
ssh -i ~/.ssh/id_ed25519 root@seu-servidor-ip
```

---

## ✅ Passo 2: Adicionar Secrets no GitHub

### 1️⃣ Abra GitHub → seu repositório WA-PRO

```
https://github.com/talio201/WA-PRO
```

### 2️⃣ Vá para Settings → Secrets and variables → Actions
```
https://github.com/talio201/WA-PRO/settings/secrets/actions
```

### 3️⃣ Clique "New repository secret" e adicione CADA UM:

Secrets obrigatórios:
- `DO_HOST`
- `DO_USERNAME`
- `DO_SSH_KEY`

Secret opcional:
- `DO_PORT` (se nao informar, o workflow usa porta `22`)

---

### 🔑 **Secret #1: DO_HOST**
- **Name**: `DO_HOST`
- **Value**: seu IP ou hostname (ex: `144.126.214.121` ou `seu-dominio.com`)

```bash
# Para descobrir seu IP (via SSH no servidor):
curl -s https://api.ipify.org
# ou
hostname -I | awk '{print $1}'
```

---

### 🔑 **Secret #2: DO_USERNAME**
- **Name**: `DO_USERNAME`
- **Value**: seu username SSH (ex: `root`, `ubuntu`, `deploy`, etc)

```bash
# Para descobrir (via SSH no servidor):
whoami
```

---

### 🔑 **Secret #3: DO_SSH_KEY**
- **Name**: `DO_SSH_KEY`
- **Value**: **CONTEÚDO COMPLETO** da sua **chave privada SSH**

```bash
# Copie TUDO (incluindo BEGIN/END):
cat ~/.ssh/id_ed25519

# Vai parecer assim (EXEMPLO):
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUtY25vbmXAAAAg...
[muitas linhas de strings aleatórias]
...
-----END OPENSSH PRIVATE KEY-----
```

⚠️ **IMPORTANTE**: 
- Não compartilhe essa chave com ninguém!
- Ela fica criptografada no GitHub (apenas GitHub Actions consegue ler)
- Se vazar, regenere: `ssh-keygen -t ed25519 ...`

---

### 🔑 **Secret #4 (Opcional): DO_PORT**
- **Name**: `DO_PORT`
- **Value**: porta SSH customizada (ex: `52088`)

Se seu servidor usa a porta padrão SSH, não precisa criar este secret.

---

## ✅ Passo 3: Verificar que funcionou

```bash
# 1. Fazer commit qualquer para testar
echo "# Deploy test" >> README.md
git add README.md
git commit -m "test: trigger deploy"
git push origin main

# 2. Ir para GitHub Actions
# https://github.com/talio201/WA-PRO/actions

# 3. Ver status do deploy:
#    🟢 Green = sucesso!
#    🔴 Red = erro (clique para ver logs)
#    🟡 Amarelo = em progresso
```

---

## 😠 Troubleshooting

### ❌ "SSH Connection refused"
- Serverip/hostname errado em `DO_HOST`
- Porta SSH não é 22 (crie `DO_PORT` com a porta correta)
- Chave pública não foi adicionada ao servidor corretamente

### ❌ "Permission denied (publickey)"
- Chave privada está incorreta
- Usuário em `DO_USERNAME` não tem permissão com essa chave
- Teste localmente: `ssh -i ~/.ssh/id_ed25519 root@seu-host`

### ❌ "Deploy script not found"
- O script `scripts/deploy.sh` não existe (será criado ou use manual deploy)
- Caminho está errado no workflow

---

## 🚀 Próximo passo:

Depois que secrets estão configurados, **qualquer push para `main` dispara deploy automático**:

```bash
git push origin main
# → GitHub Actions roda automaticamente
# → Server reclupa git + rebuild Docker  
# → Health checks validam se tudo funciona
# → Se falhar, rollback automático
```

Quer testar agora? Faça:
```bash
git status  # deve mostrar clean
git push origin main
# Depois vá em https://github.com/talio201/WA-PRO/actions
```

---

**Próximas etapas após secrets configurados:**
1. ✅ Push para main
2. ✅ Aguardar deploy no GitHub Actions
3. ✅ Testar login no webapp (dados devem persistir!)
4. ✅ Verificar logs: `docker compose logs -f backend`
