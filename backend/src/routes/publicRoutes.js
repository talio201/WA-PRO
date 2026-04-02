const express = require('express');
const router = express.Router();
const publicActivationController = require('../controllers/publicActivationController');
const requireAuth = require('../middleware/authMiddleware');
const { createRateLimiter, getClientIp } = require('../middleware/rateLimitMiddleware');

const publicReadLimiter = createRateLimiter({
	keyPrefix: 'public-read',
	maxRequests: 120,
	windowMs: 60 * 1000,
	keyFn: (req) => getClientIp(req),
	errorMessage: 'Muitas consultas públicas. Aguarde alguns segundos.',
});

const activationWriteLimiter = createRateLimiter({
	keyPrefix: 'public-activation-write',
	maxRequests: 30,
	windowMs: 60 * 1000,
	keyFn: (req) => getClientIp(req),
	errorMessage: 'Muitas tentativas de ativação. Tente novamente em instantes.',
});

const activationSessionLimiter = createRateLimiter({
	keyPrefix: 'public-activation-session',
	maxRequests: 12,
	windowMs: 60 * 1000,
	keyFn: (req) => {
		const ip = getClientIp(req);
		const code = String(req.body?.activationCode || '').trim().toUpperCase();
		return `${ip}|${code || 'no-code'}`;
	},
	errorMessage: 'Tentativas de sessão excedidas para este código de ativação.',
});

router.post('/installations/register', activationWriteLimiter, publicActivationController.registerInstallation);
router.post('/saas/signup-request', activationWriteLimiter, publicActivationController.requestSaasSignupApproval);
router.post('/admin/bootstrap', activationWriteLimiter, requireAuth, publicActivationController.bootstrapAdminAccess);
router.get('/installations/:activationCode/status', publicReadLimiter, publicActivationController.getActivationStatus);
router.post('/installations/session', activationSessionLimiter, publicActivationController.createSession);
router.post('/installations/heartbeat', activationWriteLimiter, publicActivationController.heartbeat);
router.get('/runtime-config', publicReadLimiter, publicActivationController.getPublicRuntimeConfig);

module.exports = router;
