const express = require('express');
const router = express.Router();
const { createCampaign, getCampaigns, deleteCampaign, getCampaignFailures } = require('../controllers/campaignController');

// Route: /api/campaigns
router.post('/', createCampaign);
router.get('/', getCampaigns);
router.get('/:id/failures', getCampaignFailures);
router.delete('/:id', deleteCampaign);

module.exports = router;
