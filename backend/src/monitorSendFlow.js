// backend/src/monitorSendFlow.js
// Middleware para monitorar e logar toda a sequência de envio de mensagens e erros

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../../send_flow.log');

function logSendFlow(event, data = {}) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        event,
        ...data,
    };
    fs.appendFileSync(LOG_PATH, JSON.stringify(logEntry) + '\n');
}

// Middleware Express para logar requisições de envio
function sendFlowLogger(req, res, next) {
    logSendFlow('request', {
        method: req.method,
        path: req.originalUrl || req.path,
        body: req.body,
    });
    next();
}

// Função para logar respostas e erros do envio
function logSendResult({ jobId, status, error, extra }) {
    logSendFlow('send_result', {
        jobId,
        status,
        error: error ? (error.message || error) : null,
        extra,
    });
}

module.exports = {
    sendFlowLogger,
    logSendResult,
};
