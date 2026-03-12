const express = require("express");
const router = express.Router();
const { generateVariants } = require("../controllers/aiController");
function requireGeminiPermission(req, res, next) {
	if (req.permissions?.allowGemini === false) {
		return res.status(403).json({ msg: "This bot does not have Gemini permission." });
	}
	return next();
}
router.post("/generate-variants", requireGeminiPermission, generateVariants);
module.exports = router;
