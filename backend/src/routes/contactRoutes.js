const express = require("express");
const router = express.Router();
const upload = require("../config/upload");
const {
  getContacts,
  addContact,
  importContacts,
  deleteContact
} = require("../controllers/contactController");

router.get("/", getContacts);
router.post("/", addContact);
router.post("/import", upload.single("file"), importContacts);
router.delete("/:id", deleteContact);

module.exports = router;
