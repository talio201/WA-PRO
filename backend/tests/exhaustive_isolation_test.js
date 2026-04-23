
async function runExhaustiveTest() {
    console.log('🧪 INICIANDO TESTE EXAUSTIVO DE ISOLAMENTO E ANTI-ECO (V2)...');

    const API_URL = 'http://localhost:3000/api';
    const agents = {
        A: { id: 'agent_alpha', phone: '5511911111111' },
        B: { id: 'agent_bravo', phone: '5511922222222' }
    };

    const callApi = async (path, method = 'GET', body = null, agentId = '') => {
        const res = await fetch(`${API_URL}${path}`, {
            method,
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer DEV_KEY',
                'x-agent-id': agentId 
            },
            body: body ? JSON.stringify(body) : null
        });
        if (!res.ok && res.status !== 404 && res.status !== 409) {
            const err = await res.text();
            throw new Error(`API Error ${res.status} on ${method} ${path}: ${err}`);
        }
        if (res.status === 404) return { status: 404 };
        return { status: res.status, data: await res.json() };
    };

    try {
        console.log('\n[1/4] Configurando campanhas...');
        
        const campB = await callApi('/campaigns', 'POST', {
            name: 'Prioridade Bravo',
            messageTemplate: 'URGENTE B',
            contacts: [{ phone: '5511999990002', name: 'Cliente B' }]
        }, agents.B.id);
        console.log('✅ Campanha B criada.');

        const campA = await callApi('/campaigns', 'POST', {
            name: 'Normal Alpha',
            messageTemplate: 'Normal A',
            contacts: [{ phone: '5511999990001', name: 'Cliente A' }]
        }, agents.A.id);
        console.log('✅ Campanha A criada.');

        console.log('\n[2/4] Testando isolamento de fila...');
        
        const jobA = await callApi('/messages/next', 'GET', null, agents.A.id);
        if (jobA.data.job) {
            if (jobA.data.job.agentId === agents.B.id) {
                console.error('❌ ERRO: Agente A recebeu mensagem do Agente B!');
                process.exit(1);
            }
            console.log('✅ SUCESSO: Agente A isolado.');
        }

        const jobB = await callApi('/messages/next', 'GET', null, agents.B.id);
        if (jobB.data.job && jobB.data.job.agentId === agents.B.id) {
            console.log('✅ SUCESSO: Agente B recebeu sua mensagem.');
        }

        console.log('\n[3/4] Testando bloqueio de Mensagem Reversa (Eco)...');
        const testPhone = '5511988887777';
        const testMsg = 'Eco Test 123';

        // URL CORRIGIDA: /outbound/manual
        console.log('📤 Enviando manual-outbound...');
        await callApi('/messages/outbound/manual', 'POST', {
            phone: testPhone, text: testMsg, campaignId: campA.data._id
        }, agents.A.id);

        console.log('📥 Simulando Inbound (Eco)...');
        const echoRes = await callApi('/messages/inbound', 'POST', {
            phone: testPhone, text: testMsg
        }, agents.A.id);

        if (echoRes.data.duplicate) {
            console.log('✅ SUCESSO: Eco bloqueado.');
        } else {
            console.error('❌ FALHA: Eco permitido! (Mensagem duplicada aceita)');
            process.exit(1);
        }

        console.log('\n[4/4] Testando IDOR...');
        const jobBCheck = await callApi('/messages/next', 'GET', null, agents.B.id);
        if (jobBCheck.data.job) {
            const msgIdB = jobBCheck.data.job._id || jobBCheck.data.job.id;
            console.log(`🕵️ Agente A tentando marcar a mensagem do Agente B (${msgIdB}) como 'sent'...`);
            const idorRes = await callApi(`/messages/${msgIdB}`, 'PATCH', { status: 'sent' }, agents.A.id);
            
            if (idorRes.status === 404) {
                console.log('✅ SUCESSO: Acesso negado ao invasor (IDOR bloqueado).');
            } else {
                console.error('❌ FALHA: Invasor conseguiu acessar mensagem de outro!');
                process.exit(1);
            }
        } else {
            console.log('❓ AVISO: Agente B não tinha mensagens para o teste de IDOR.');
        }

        console.log('\n✨ TODOS OS TESTES PASSARAM! SISTEMA BLINDADO LOCALMENTE. ✨');
        process.exit(0);

    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
}

runExhaustiveTest();
