// Script de teste: busca contatos do Supabase e mostra os números salvos
const SUPABASE_URL = 'https://izmellnvkwbapcrfuqgp.supabase.co';
const SUPABASE_KEY = '[REDACTED_JWT]';

async function testFetch() {
    // Buscar 10 contatos com server = c.us (que devem ter número real)
    const url = `${SUPABASE_URL}/rest/v1/contacts?select=id,name,number,server&server=eq.c.us&limit=10`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        console.error('Erro:', await response.text());
        return;
    }

    const data = await response.json();

    console.log('\n=== CONTATOS @c.us DO SUPABASE (devem ter número real) ===\n');
    data.forEach((c, i) => {
        console.log(`[${i + 1}] Nome: "${c.name}" | Número: "${c.number}" | ID: "${c.id}" | Server: "${c.server}"`);
    });

    // Agora buscar 5 contatos @lid para comparar
    const urlLid = `${SUPABASE_URL}/rest/v1/contacts?select=id,name,number,server&server=eq.lid&limit=5`;
    const responseLid = await fetch(urlLid, {
        method: 'GET',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    const dataLid = await responseLid.json();

    console.log('\n=== CONTATOS @lid DO SUPABASE (IDs internos, sem tel real) ===\n');
    dataLid.forEach((c, i) => {
        console.log(`[${i + 1}] Nome: "${c.name}" | Número: "${c.number}" | ID: "${c.id}" | Server: "${c.server}"`);
    });

    console.log(`\n=== TOTAL: ${data.length} @c.us + ${dataLid.length} @lid mostrados ===`);
}

testFetch();
