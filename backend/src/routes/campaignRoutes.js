const express = require("express");
const router = express.Router();
const {
  createCampaign,
  getCampaigns,
  deleteCampaign,
  getCampaignFailures,
  updateCampaign,
  dispatchNextCampaignContact,
  retryCampaignFailures,
  controlCampaignSending,
} = require("../controllers/campaignController");
router.post("/", createCampaign);
router.get("/", getCampaigns);
router.get("/:id/failures", getCampaignFailures);
router.patch("/:id", updateCampaign);
router.post("/:id/dispatch-next", dispatchNextCampaignContact);
router.post("/:id/retry-failures", retryCampaignFailures);
router.post("/:id/control-sending", controlCampaignSending);
router.delete("/:id", deleteCampaign);
module.exports = router;
