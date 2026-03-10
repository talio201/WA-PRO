const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res
      .status(401)
      .json({ msg: "Unauthorized: Missing Authorization header" });
  }
  const token = String(authHeader.split(' ')[1] || '').trim();
  const validKey = String(process.env.API_SECRET_KEY || '').trim();
  if (token !== validKey) {
    return res.status(401).json({ msg: `Unauthorized: Invalid API Key.` });
  }
  
  // Pegar e validar agentId, essencial para não cruzar dados entre computadores/usuários
  const isBotRoute = req.path.includes('/messages/next') || req.path.includes('/messages/inbound') || req.path.includes('/status');
  const agentId = req.headers['x-agent-id'];
  
  if (!agentId && !isBotRoute) {
     return res.status(401).json({ msg: "Unauthorized: Missing x-agent-id header. Every frontend request must identify its agent ID." });
  }

  req.agentId = agentId || 'bot';
  next();
};
module.exports = requireAuth;
