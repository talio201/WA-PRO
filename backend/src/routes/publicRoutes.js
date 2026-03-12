const express = require('express');
const router = express.Router();
const publicActivationController = require('../controllers/publicActivationController');

router.post('/installations/register', publicActivationController.registerInstallation);
router.get('/installations/:activationCode/status', publicActivationController.getActivationStatus);
router.post('/installations/session', publicActivationController.createSession);
router.post('/installations/heartbeat', publicActivationController.heartbeat);

module.exports = router;
