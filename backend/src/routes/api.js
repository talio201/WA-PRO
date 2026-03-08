const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');
const messageController = require('../controllers/messageController');

// Campaign Routes
router.post('/campaigns', campaignController.createCampaign);
router.get('/campaigns', campaignController.getCampaigns);

// Message Routes (Queue Consumer)
router.get('/messages/next', messageController.getNextJob);
router.put('/messages/:id/status', messageController.updateStatus);

module.exports = router;
