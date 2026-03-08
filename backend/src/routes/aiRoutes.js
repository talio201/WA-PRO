const express = require('express');
const router = express.Router();
const { generateVariants } = require('../controllers/aiController');

// Route: /api/ai
router.post('/generate-variants', generateVariants);

module.exports = router;

