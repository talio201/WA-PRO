const express = require("express");
const router = express.Router();
const {
  createCampaign,
  getCampaigns,
  deleteCampaign,
  getCampaignFailures,
  updateCampaign,
  dispatchNextCampaignContact,
} = require("../controllers/campaignController");
router.post("/", createCampaign);
router.get("/", getCampaigns);
router.get("/:id/failures", getCampaignFailures);
router.patch("/:id", updateCampaign);
router.post("/:id/dispatch-next", dispatchNextCampaignContact);
router.delete("/:id", deleteCampaign);
module.exports = router;
