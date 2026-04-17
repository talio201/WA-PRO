const Contact = require("../models/Contact");
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

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function detectDelimiter(headerLine) {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semicolonCount = (headerLine.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseDelimitedLine(line, delimiter) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === delimiter && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function parseCsvBuffer(buffer) {
  const text = String(buffer || "")
    .replace(/^\uFEFF/, "")
    .trim();

  if (!text) return [];

  const lines = text.split(/\r?\n/).filter((line) => String(line).trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter).map(normalizeHeader);

  return lines.slice(1).map((line) => {
    const values = parseDelimitedLine(line, delimiter);
    return headers.reduce((row, header, index) => {
      if (header) row[header] = values[index] ?? "";
      return row;
    }, {});
  });
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
      return res.status(400).json({ msg: "Please upload a CSV file" });
    }

    const fileName = String(req.file.originalname || "").toLowerCase();
    if (!fileName.endsWith(".csv")) {
      return res.status(400).json({ msg: "Please upload a CSV file" });
    }

    const rawData = parseCsvBuffer(req.file.buffer);

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
