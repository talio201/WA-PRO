# WhatsApp Campaign Manager - V2

**Gerenciador de Campanhas em Massa para WhatsApp Web**

Este projeto é uma solução completa para automatizar o envio de mensagens de marketing via WhatsApp Web, utilizando uma extensão do Chrome para simular comportamento humano (Anti-Ban) e um backend local para gerenciar filas e arquivos.

## 🚀 Funcionalidades V2

*   **Dashboard Moderno:** Visualização em tempo real de envios, falhas e filas.
*   **Importação de Excel:** Suporte nativo a arquivos `.xlsx` e `.csv` (Arraste e Solte).
*   **Envio de Mídia:** Envie imagens (`.jpg`, `.png`) junto com suas mensagens de texto. As imagens são coladas automaticamente no chat.
*   **Navegação Híbrida Inteligente:**
    *   *Modo DOM:* Busca o contato na lista existente (muito rápido, sem refresh).
    *   *Modo URL:* Recarrega a página apenas se o contato não for encontrado.
*   **Anti-Ban:** Simulação de digitação real, cliques humanos e delays variáveis.
*   **Backend Local:** Sem necessidade de configurar MongoDB externo. Usa um banco JSON local simples.

## 📂 Estrutura do Projeto

*   `backend/`: Servidor Node.js (API, Banco de Dados JSON, Uploads).
*   `extension/`: Extensão Chrome (React, Vite, Tailwind CSS).

## 🛠️ Instalação e Uso

### 1. Iniciar o Backend
O backend precisa estar rodando para a extensão funcionar.

1.  Abra o terminal na pasta `backend`.
2.  Instale as dependências:
    ```bash
    npm install
    ```
3.  Inicie o servidor:
    ```bash
    npm run dev
    ```
    *O servidor rodará em `http://localhost:3000` (se você usar a porta 5000 e receber 403, é porque ela pode estar ocupada pelo macOS).*

### 2. Instalar a Extensão
1.  Abra o terminal na pasta `extension`.
2.  Instale as dependências e faça o build:
    ```bash
    npm install
    npm run build
    ```
3.  No Google Chrome, acesse `chrome://extensions`.
4.  Ative o **Modo do desenvolvedor** (canto superior direito).
5.  Clique em **Carregar sem compactação**.
6.  Selecione a pasta `extension/dist`.

### 3. Utilização
1.  Clique no ícone da extensão para ver o Popup de status.
2.  Clique com o botão direito no ícone e selecione **Opções** para abrir o **Dashboard**.
3.  No Dashboard:
    *   Crie uma nova campanha.
    *   Importe sua lista de contatos.
    *   Anexe uma imagem (opcional).
    *   Dê o start e acompanhe o progresso!

## ⚠️ Notas Importantes
*   **WhatsApp Web:** Você precisa estar logado no WhatsApp Web para que a extensão funcione.
*   **Foco:** Para o envio de imagens (colar), é recomendável manter a janela do Chrome visível em algum momento, embora a extensão tente focar automaticamente.

## 👨‍💻 Tecnologias
*   Node.js & Express
*   React & Vite
*   Tailwind CSS & Recharts
*   Chrome Extension Manifest V3

## 🚚 Deploy no Servidor Remoto
Deploy é feito via terminal remoto (SSH). Conecte ao servidor e rode:

```bash
cd /opt/EmidiaWhats
git pull origin main
docker-compose up -d --build
docker-compose ps
```

Observação: evite `docker-compose down` no deploy padrão para não causar indisponibilidade quando houver erro de configuração.

## 📋 Setup Inicial do Servidor (primeira vez)
Se for um novo servidor, rode uma vez:

```bash
apt-get update && apt-get install -y git curl
curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh
mkdir -p /opt/EmidiaWhats && cd /opt/EmidiaWhats
git clone https://github.com/talio201/WA-PRO.git .
git pull origin main
docker-compose up -d --build
```

# WA-Manager-PRO
