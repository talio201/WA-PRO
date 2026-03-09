const http = require('http');

const PORT = 3000;
const SECRET_KEY = '[REDACTED_API_SECRET]';
const ENDPOINT = '/api/campaigns';

function makeRequest(headers, expectedStatus, testName) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: PORT,
            path: ENDPOINT,
            method: 'GET',
            headers: headers
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === expectedStatus) {
                    console.log(`PASS: ${testName} - Retornou Status ${res.statusCode} corretamente.`);
                    resolve(true);
                } else {
                    console.error(`FAIL: ${testName} - Esperava ${expectedStatus}, obteve ${res.statusCode}\nBODY: ${data}`);
                    resolve(false);
                }
            });
        });

        req.on('error', (e) => {
            console.error(`FAIL: Request falhou estruturalmente - ${e.message}`);
            resolve(false);
        });

        req.end();
    });
}

async function runTests() {
    console.log("Iniciando Testes de Segurança (JWT & API KEY)...\n");

    const t1 = await makeRequest({}, 401, 'Request Localhost s/ Header Authorization');
    
    const t2 = await makeRequest({'Authorization': 'Bearer HackerKey'}, 401, 'Request Localhost c/ Header Invalido');
    
    const t3 = await makeRequest({'Authorization': `Bearer ${SECRET_KEY}`}, 200, 'Request Localhost c/ JWT Header Válido');

    console.log("\n--- Resultado da Auditoria Automatizada ---");
    if (t1 && t2 && t3) {
        console.log("SEGURO E BLINDADO: A aplicação não possui brechas fáceis em localhost.");
        process.exit(0);
    } else {
        console.log("COMPROMETIDO: Falhas detectadas nos interceptadores do Express.js");
        process.exit(1);
    }
}

runTests();
