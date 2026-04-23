
const express = require('express');
const app = express();
app.use(express.json());

const store = {
    campaigns: [],
    messages: [],
    conversation_assignments: [],
    contacts: [],
    support_protocols: []
};

// Mock Supabase REST API
app.get('/rest/v1/:table', (req, res) => {
    const table = req.params.table;
    console.log(`[GET] ${table}`, req.query);
    if (!store[table]) return res.status(404).send(`Table ${table} not found`);
    
    let data = [...store[table]];
    
    Object.entries(req.query).forEach(([key, val]) => {
        const value = String(val).startsWith('eq.') ? val.split('.')[1] : val;
        if (key === 'agent_id') data = data.filter(i => String(i.agent_id) === value);
        if (key === 'phone') data = data.filter(i => String(i.phone) === value);
        if (key === 'status') data = data.filter(i => String(i.status) === value);
        if (key === 'id') data = data.filter(i => String(i.id) === value);
        if (key === 'campaign_id') data = data.filter(i => String(i.campaign_id) === value);
    });

    res.json(data);
});

app.post('/rest/v1/:table', (req, res) => {
    const table = req.params.table;
    console.log(`[POST] ${table}`, req.body);
    if (!store[table]) return res.status(404).send(`Table ${table} not found`);

    const items = Array.isArray(req.body) ? req.body : [req.body];
    const created = items.map(i => {
        const id = i.id || 'id_' + Math.random().toString(36).substr(2, 9);
        return { 
            id: id,
            _id: id,
            ...i, 
            created_at: new Date().toISOString() 
        };
    });
    
    store[table].push(...created);
    res.status(201).json(Array.isArray(req.body) ? created : created[0]);
});

app.patch('/rest/v1/:table', (req, res) => {
    const table = req.params.table;
    console.log(`[PATCH] ${table} Query:`, req.query, "Body:", req.body);
    if (!store[table]) return res.status(404).send(`Table ${table} not found`);

    const idVal = req.query.id;
    const id = String(idVal).startsWith('eq.') ? idVal.split('.')[1] : idVal;

    if (!id) return res.status(400).send('ID required for PATCH');

    const index = store[table].findIndex(m => String(m.id) === String(id));
    if (index !== -1) {
        store[table][index] = { ...store[table][index], ...req.body, updated_at: new Date().toISOString() };
        res.json(store[table][index]);
    } else {
        res.status(404).send(`Record ${id} not found in ${table}`);
    }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Mock Supabase Full-Service v3 rodando na porta ${PORT}`));
