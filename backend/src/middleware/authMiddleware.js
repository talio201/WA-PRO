const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res
      .status(401)
      .json({ msg: "Unauthorized: Missing Authorization header" });
  }
  const token = String(authHeader.split(' ')[1] || '').trim();
  const validKey = String(process.env.API_SECRET_KEY || '').trim();
  console.log("-> [DEBUG AUTH] Token recebido:", token, "| Esperado:", validKey);
  if (token !== validKey) {
    return res.status(401).json({ msg: `Unauthorized: Invalid API Key. Got: [${token}], Expected: [${validKey}]` });
  }
  next();
};
module.exports = requireAuth;
