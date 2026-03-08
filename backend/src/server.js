require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const connectDB = require('./config/db');
const { initRealtimeServer, emitRealtimeEvent } = require('./realtime/realtime');

const app = express();

// Connect Database (Using Local JSON DB now)
// connectDB();

// Middleware
app.use(cors());
app.use(express.json({ extended: false }));

// Define Routes
app.get('/', (req, res) => res.json({ msg: 'WhatsApp Campaign Manager API Running' }));

// Static folder for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Monitoramento do fluxo de envio
const { sendFlowLogger } = require('./monitorSendFlow');
app.use('/api/messages', sendFlowLogger);

// Routes
app.use('/api/campaigns', require('./routes/campaignRoutes'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/upload', require('./routes/uploadRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));
// The original '/api' route is replaced by more specific routes as per the instruction's implied change.
// app.use('/api', require('./routes/api')); // This line is removed as specific routes are added.

// Ensure malformed JSON requests return a JSON response instead of HTML stack traces.
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ msg: 'Invalid JSON payload.' });
    }

    return next(err);
});

// NOTE: some environments may already bind to 5000, causing confusing 403s when the extension hits the wrong process.
// Default to 3000 (can be overridden via PORT in backend/.env).
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
initRealtimeServer(server);

server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    emitRealtimeEvent('system.server_started', {
        port: Number(PORT),
        storageProvider: String(process.env.STORAGE_PROVIDER || process.env.DB_PROVIDER || 'local').toLowerCase(),
    });
});
