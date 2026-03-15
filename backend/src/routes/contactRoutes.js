const express = require("express");
const router = express.Router();
const upload = require("../config/upload");
const {
  getContacts,
  addContact,
  importContacts,
  deleteContact,
  updateContactCrm,
  getLeadAnalytics,
} = require("../controllers/contactController");

router.get("/", getContacts);
router.get("/analytics", getLeadAnalytics);
router.post("/", addContact);
router.post("/import", upload.single("file"), importContacts);
router.patch("/:id/crm", updateContactCrm);
router.delete("/:id", deleteContact);

module.exports = router;
