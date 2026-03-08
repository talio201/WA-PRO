// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = path.join(__dirname, 'contatos_whatsapp.json');


// ---------- SALVAR CONTATOS (WhatsApp envia aqui)
app.post('/contacts', (req, res) => {
    try {
        const contacts = req.body;

        if (!Array.isArray(contacts)) {
            return res.status(400).json({ error: "Formato inválido" });
        }

        fs.writeFileSync(DB_FILE, JSON.stringify(contacts, null, 2));

        console.log(`📥 ${contacts.length} contatos salvos no arquivo`);
        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});


// ---------- LISTAR TODOS (Postman usa aqui)
app.get('/contacts', (req, res) => {
    try {
        if (!fs.existsSync(DB_FILE)) {
            return res.json([]);
        }

        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        res.json(data);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ---------- FILTRAR POR NUMERO
app.get('/contacts/:numero', (req, res) => {
    try {
        if (!fs.existsSync(DB_FILE)) {
            return res.json([]);
        }

        const contatos = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        const numero = req.params.numero;

        const resultado = contatos.filter(c =>
            JSON.stringify(c).includes(numero)
        );

        res.json(resultado);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ---------- OTIF API AI PROXY
// Endpoint para reescrever mensagens via Gemini (Server-side) e esconder API KEY
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'SUA_CHAVE_AQUI_SE_NAO_USAR_ENV');

app.post('/api/rewrite', async (req, res) => {
    try {
        const { text, tone } = req.body;
        if (!text) return res.status(400).json({ error: 'Texto obrigatório' });

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
            Você é um copywriter especialista em mensagens de WhatsApp.
            Gere 5 versões da mensagem abaixo mantendo o sentido original, mas variando o tom.
            
            Requisitos:
            - Português do Brasil natural e humano.
            - NADA de "Espero que esteja bem" robótico.
            - Mantenha variáveis como {name} intactas.
            
            Mensagem Base: "${text}"
            
            Retorne APENAS um JSON estrito neste formato (sem markdown):
            {
              "versions": [
                {"title":"Curta", "text":"..."},
                {"title":"Direta", "text":"..."},
                {"title":"Amigável", "text":"..."},
                {"title":"Profissional", "text":"..."},
                {"title":"Persuasiva", "text":"..."}
              ]
            }
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const textResponse = response.text();

        // Limpar markdown se houver (```json ... ```)
        const cleanJson = textResponse.replace(/```json|```/g, '').trim();

        res.json(JSON.parse(cleanJson));

    } catch (error) {
        console.error('AI Error:', error);
        res.status(500).json({ error: 'Erro ao gerar variações: ' + error.message });
    }
});


app.listen(3000, () => {
    console.log('🚀 Servidor rodando em http://localhost:3000');
    console.log('POST -> WhatsApp envia contatos');
    console.log('GET  -> Postman consulta contatos');
});
