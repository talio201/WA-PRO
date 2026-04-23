
const axios = require('axios');

const API_URL = 'http://localhost:3000/api'; // Seu backend local
const FAKE_WA_URL = 'http://localhost:4000/mock';

async function runIsolationTest() {
    console.log('🚀 INICIANDO TESTE DE ISOLAMENTO DE TENANTS...');

    try {
        // 1. Simular o Agente Vítima (User A)
        const victimAgent = 'victims_id_123';
        const attackerAgent = 'attacker_id_666';

        console.log('Step 1: Criando campanha para a Vítima...');
        // Simulamos a inserção de uma campanha no banco (via endpoint que corrigimos)
        // Usamos um token de autenticação simulado ou bypass de dev se ativo
        const campaignRes = await axios.post(`${API_URL}/campaigns`, {
            name: 'Campanha Privada Vítima',
            messageTemplate: 'Olá, este é um segredo da Vítima',
            contacts: [{ phone: '551199999999', name: 'Cliente Fiel' }]
        }, { headers: { 'Authorization': 'Bearer DEV_TOKEN_VICTIM', 'x-agent-id': victimAgent } });

        const campaignId = campaignRes.data._id;
        console.log(`✅ Campanha da Vítima criada: ${campaignId}`);

        // 2. Simular o Ataque: O Atacante tenta pedir o próximo Job
        console.log('\nStep 2: Atacante tenta puxar trabalho (Exploiting IDOR)...');
        
        const attackRes = await axios.get(`${API_URL}/messages/next`, {
            headers: { 
                'Authorization': 'Bearer DEV_TOKEN_ATTACKER', 
                'x-agent-id': attackerAgent // O Atacante se identifica como ele mesmo
            }
        });

        if (attackRes.data.job && attackRes.data.job.campaign === campaignId) {
            console.error('❌ FALHA CRÍTICA: O Atacante conseguiu puxar a mensagem da Vítima!');
            process.exit(1);
        } else {
            console.log('✅ SUCESSO: O Atacante não recebeu nenhuma mensagem da Vítima.');
        }

        // 3. Simular o Robô da Vítima trabalhando
        console.log('\nStep 3: Validando se o Robô legítimo recebe o trabalho...');
        const victimJobRes = await axios.get(`${API_URL}/messages/next`, {
            headers: { 
                'Authorization': 'Bearer DEV_TOKEN_VICTIM', 
                'x-agent-id': victimAgent 
            }
        });

        if (victimJobRes.data.job && victimJobRes.data.job.campaign === campaignId) {
            console.log('✅ SUCESSO: O Robô legítimo recebeu sua própria mensagem.');
        } else {
            console.log('❓ AVISO: Mensagem não encontrada (verificar status da campanha).');
        }

    } catch (error) {
        console.error('❌ Erro durante o teste:', error.response?.data || error.message);
    }
}

runIsolationTest();
