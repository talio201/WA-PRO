const Contact = require("../models/Contact");
const XLSX = require("xlsx");
const { buildServerErrorResponse } = require("../utils/httpError");
const { normalizePhone } = require("../utils/phone");
const {
  ensureLead,
  getLeadByAgentAndPhone,
  updateLead,
  buildLeadAnalytics,
} = require("../config/crmStore");

function mergeContactWithLead(contact = {}, lead = null) {
  return {
    ...contact,
    crm: {
      stage: lead?.stage || 'new',
      score: Number(lead?.score || 0),
      owner: lead?.owner || '',
      tags: Array.isArray(lead?.tags) ? lead.tags : [],
      notes: lead?.notes || '',
      nextActionAt: lead?.nextActionAt || null,
      lastInboundAt: lead?.lastInboundAt || null,
      lastOutboundAt: lead?.lastOutboundAt || null,
      updatedAt: lead?.updatedAt || null,
    },
  };
}

function resolveOwnerId(req) {
  return String(req.agentId || req.user?.id || "").trim();
}

exports.getContacts = async (req, res) => {
  try {
    const agentId = resolveOwnerId(req);
    if (!agentId || agentId === 'bot') {
       return res.status(403).json({ msg: "Bot cannot list contacts or agentId missing" });
    }
    const contacts = await Contact.find({ agentId });
    const merged = (Array.isArray(contacts) ? contacts : []).map((contact) => {
      const lead = getLeadByAgentAndPhone(agentId, contact.phone || '');
      if (!lead && contact.phone) {
        ensureLead(agentId, contact.phone, {
          owner: agentId,
        });
      }
      const refreshedLead = getLeadByAgentAndPhone(agentId, contact.phone || '');
      return mergeContactWithLead(contact, refreshedLead);
    });
    res.json(merged);
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};

exports.addContact = async (req, res) => {
  try {
    const agentId = resolveOwnerId(req);
    if (!agentId || agentId === 'bot') {
       return res.status(403).json({ msg: "Bot cannot create contacts or agentId missing" });
    }
    
    const { name, phone } = req.body;
    if (!phone) {
      return res.status(400).json({ msg: "Phone is required" });
    }

    const normalized = normalizePhone(phone).normalized || String(phone).replace(/\D/g, "");

    // Evitar duplicidade para este agentId
    const existing = await Contact.find({ agentId, phone: normalized });
    if (existing && existing.length > 0) {
       return res.status(409).json({ msg: "Contact already exists for this agent." });
    }

    const doc = await Contact.insertMany([{ name: name || "", phone: normalized, agentId }]);
    const created = Array.isArray(doc) ? doc[0] : null;
    const lead = ensureLead(agentId, normalized, {
      owner: agentId,
      stage: 'new',
      score: 0,
    });
    res.status(201).json(mergeContactWithLead(created || {}, lead));
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};

exports.importContacts = async (req, res) => {
  try {
    const agentId = resolveOwnerId(req);
    if (!agentId || agentId === 'bot') {
       return res.status(403).json({ msg: "Bot cannot import contacts or agentId missing" });
    }

    if (!req.file) {
      return res.status(400).json({ msg: "Please upload an excel file" });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const toInsert = [];
    const duplicated = [];
    
    // Check existing mapping
    const existingContacts = await Contact.find({ agentId });
    const existingPhones = new Set(existingContacts.map(c => c.phone));

    for (const row of rawData) {
      const rawPhone = row.Telefone || row.telefone || row.Phone || row.phone || row.Numero || row.numero;
      const name = row.Nome || row.nome || row.Name || row.name || "";
      
      if (!rawPhone) continue;

      const normalized = normalizePhone(String(rawPhone)).normalized || String(rawPhone).replace(/\D/g, "");
      if (!normalized) continue;

      if (existingPhones.has(normalized)) {
         duplicated.push(normalized);
         continue;
      }
      
      existingPhones.add(normalized); // Prevenir duplicados no próprio arquivo
      toInsert.push({ name: String(name).trim(), phone: normalized, agentId });
    }

    if (toInsert.length > 0) {
      await Contact.insertMany(toInsert);
      toInsert.forEach((item) => {
        ensureLead(agentId, item.phone, {
          owner: agentId,
          stage: 'new',
          score: 0,
        });
      });
    }

    res.status(200).json({
      msg: "Import successful",
      imported: toInsert.length,
      ignored_duplicates: duplicated.length
    });
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};

exports.updateContactCrm = async (req, res) => {
  try {
    const agentId = resolveOwnerId(req);
    const { id } = req.params;
    if (!agentId || agentId === 'bot') {
      return res.status(403).json({ msg: 'Bot cannot update CRM lead.' });
    }
    const contact = await Contact.findById(id);
    if (!contact) {
      return res.status(404).json({ msg: 'Contact not found' });
    }
    if (contact.agentId !== agentId) {
      return res.status(403).json({ msg: 'Unauthorized. Contact belongs to another agent.' });
    }

    const lead = updateLead(agentId, contact.phone, {
      stage: req.body?.stage,
      score: req.body?.score,
      owner: req.body?.owner,
      tags: req.body?.tags,
      notes: req.body?.notes,
      nextActionAt: req.body?.nextActionAt,
    });

    return res.json(mergeContactWithLead(contact, lead));
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};

exports.getLeadAnalytics = async (req, res) => {
  try {
    const agentId = resolveOwnerId(req);
    if (!agentId || agentId === 'bot') {
      return res.status(403).json({ msg: 'Bot cannot access lead analytics.' });
    }
    const analytics = buildLeadAnalytics(agentId);
    return res.json(analytics);
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};

exports.deleteContact = async (req, res) => {
  try {
    const agentId = resolveOwnerId(req);
    const { id } = req.params;

    const contact = await Contact.findById(id);
    if (!contact) {
      return res.status(404).json({ msg: "Contact not found" });
    }
    
    if (contact.agentId !== agentId) {
      return res.status(403).json({ msg: "Unauthorized. Contact belongs to another agent." });
    }

    await Contact.deleteById(id);
    res.json({ msg: "Contact removed" });
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};
