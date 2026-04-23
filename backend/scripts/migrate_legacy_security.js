
const fs = require('fs');
const path = require('path');

// Caminhos dos dados
const DB_PATH = path.join(__dirname, '../data/db.json');
const ADMIN_PATH = path.join(__dirname, '../data/admin-settings.json');

async function migrate() {
  console.log('--- Iniciando Migração de Segurança para Usuários Legados ---');

  if (!fs.existsSync(DB_PATH) || !fs.existsSync(ADMIN_PATH)) {
    console.error('Arquivos de dados não encontrados.');
    return;
  }

  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const admin = JSON.parse(fs.readFileSync(ADMIN_PATH, 'utf8'));

  // 1. Mapear e-mails para AgentIDs corretos a partir do SaaS Store
  const emailToAgentId = {};
  if (admin.saasUsers) {
    admin.saasUsers.forEach(u => {
      if (u.email && u.agentId) {
        emailToAgentId[u.email.toLowerCase()] = u.agentId;
      }
    });
  }

  console.log(`Mapeados ${Object.keys(emailToAgentId).length} usuários SaaS.`);

  let updatedCampaigns = 0;
  let updatedMessages = 0;

  // 2. Corrigir Campanhas Legadas
  // Se a campanha não tem agentId, tentamos vincular pelo histórico ou marcamos como órfã (segura)
  db.campaigns = db.campaigns.map(c => {
    if (!c.agentId || c.agentId === 'bot' || c.agentId === 'system') {
      // Tentativa de recuperação: Se o nome da campanha contém algo identificável ou se o admin sabe o dono
      // Por segurança, se não soubermos o dono, atribuímos a um ID de quarentena
      c.agentId = c.agentId || 'quarantine_legacy_' + Date.now();
      updatedCampaigns++;
    }
    return c;
  });

  // 3. Corrigir Mensagens Legadas (O ponto crítico da invasão)
  // Vinculamos cada mensagem ao agentId da sua campanha pai
  const campaignToAgent = {};
  db.campaigns.forEach(c => {
    campaignToAgent[c._id] = c.agentId;
  });

  db.messages = db.messages.map(m => {
    const correctAgentId = campaignToAgent[m.campaign];
    if (correctAgentId && m.agentId !== correctAgentId) {
      m.agentId = correctAgentId;
      updatedMessages++;
    }
    // Se a mensagem não tem campanha ou a campanha sumiu, quarentena nela
    if (!m.agentId) {
      m.agentId = 'quarantine_orphan_' + Date.now();
      m.status = 'failed'; // Impede disparo de órfãs
      updatedMessages++;
    }
    return m;
  });

  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  console.log(`Sucesso: ${updatedCampaigns} campanhas e ${updatedMessages} mensagens migradas.`);
  console.log('--- O isolamento legado foi forçado com sucesso ---');
}

migrate();
