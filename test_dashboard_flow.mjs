import { ApiClient } from './js/api-client.js';

async function testDashboardFlow() {
    const api = new ApiClient();
    console.log('Iniciando teste automatizado do fluxo Dashboard → WhatsApp Web...');

    // 1. Buscar contatos do Supabase
    const contatos = await api.fetchContacts();
    if (!Array.isArray(contatos) || contatos.length === 0) {
        console.error('[TEST] Falha: Nenhum contato retornado do Supabase!');
        process.exit(1);
    }
    console.log(`[TEST] Contatos carregados: ${contatos.length}`);

    // 2. Selecionar um contato válido (com número real)
    const contatoValido = contatos.find(c => c.number && c.number.length >= 8);
    if (!contatoValido) {
        console.error('[TEST] Falha: Nenhum contato válido encontrado!');
        process.exit(1);
    }
    console.log(`[TEST] Contato válido selecionado: ${contatoValido.name || contatoValido.number}`);

    // 3. Simular envio de mensagem (mock)
    try {
        // Aqui simulamos o envio, pois não é possível acionar o WhatsApp Web real via Node.js
        // Em ambiente real, seria necessário rodar isso no browser com puppeteer ou extensão
        console.log(`[TEST] Simulando envio de mensagem para ${contatoValido.number}...`);
        // Exemplo: await api.sendMessage(contatoValido.id, 'Mensagem de teste via automação');
        console.log('[TEST] Envio simulado com sucesso (mock).');
    } catch (e) {
        console.error('[TEST] Erro ao simular envio:', e);
        process.exit(1);
    }

    // 4. Testar envio para número inexistente
    const numeroFake = '999999999999';
    try {
        console.log(`[TEST] Simulando envio para número inexistente: ${numeroFake}...`);
        // Exemplo: await api.sendMessage(numeroFake + '@c.us', 'Teste número inexistente');
        console.log('[TEST] Envio simulado para número inexistente (mock).');
    } catch (e) {
        console.log('[TEST] Erro esperado ao enviar para número inexistente:', e.message);
    }

    console.log('[TEST] Fluxo automatizado finalizado com sucesso!');
}

testDashboardFlow();
