
const express = require('express');
const app = express();
app.use(express.json());

// Simula o estado dos celulares virtuais
const virtualPhones = {
    '51982192298': { owner: 'Agente_A', messages: [] },
    '551199999999': { owner: 'Agente_B', messages: [] }
};

// Endpoint que o Bot "disparador" chama para entregar a mensagem
app.post('/mock/send', (req, res) => {
    const { from, to, message } = req.body;
    console.log(`[WHATSAPP VIRTUAL] Transmissão: ${from} -> ${to}: "${message}"`);
    
    if (virtualPhones[to]) {
        virtualPhones[to].messages.push({ from, message, at: new Date() });
    }
    res.json({ success: true, messageId: 'msg_' + Math.random().toString(36).substr(2, 9) });
});

// Endpoint para o Juiz conferir o que chegou em cada "celular"
app.get('/mock/inbox/:phone', (req, res) => {
    const phone = req.params.phone;
    res.json(virtualPhones[phone] || { messages: [] });
});

const PORT = 4000;
app.listen(PORT, () => console.log(`Laboratório de WhatsApp rodando na porta ${PORT}`));
