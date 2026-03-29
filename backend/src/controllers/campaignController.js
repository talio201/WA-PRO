const Campaign = require("../models/Campaign");
const Message = require("../models/Message");
const { normalizePhone } = require("../utils/phone");
const { buildServerErrorResponse } = require("../utils/httpError");
const { emitRealtimeEvent } = require("../realtime/realtime");
const { enqueueBotCommand } = require("../config/botControlStore");
const DEFAULT_MIN_DELAY_SECONDS = 0;
const DEFAULT_MAX_DELAY_SECONDS = 120;
const MAX_ALLOWED_DELAY_SECONDS = 3600;
const DEFAULT_RESEND_WINDOW_HOURS = 72;

function parseTimeToMinutes(value, fallback) {
  const safe = String(value || '').trim();
  const match = safe.match(/^(\d{2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return hours * 60 + minutes;
}

function sanitizeDeliveryWindow(input = {}) {
  const enabled = input?.enabled === true;
  const timezone = String(input?.timezone || 'America/Sao_Paulo').trim() || 'America/Sao_Paulo';
  const startMinutes = parseTimeToMinutes(input?.startTime, 8 * 60);
  const endMinutes = parseTimeToMinutes(input?.endTime, 20 * 60);
  const startHour = String(Math.floor(startMinutes / 60)).padStart(2, '0');
  const startMinute = String(startMinutes % 60).padStart(2, '0');
  const endHour = String(Math.floor(endMinutes / 60)).padStart(2, '0');
  const endMinute = String(endMinutes % 60).padStart(2, '0');
  const rawDays = Array.isArray(input?.daysOfWeek) ? input.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  const daysOfWeek = rawDays
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
  return {
    enabled,
    timezone,
    startTime: `${startHour}:${startMinute}`,
    endTime: `${endHour}:${endMinute}`,
    daysOfWeek: daysOfWeek.length > 0 ? Array.from(new Set(daysOfWeek)) : [0, 1, 2, 3, 4, 5, 6],
  };
}

function sanitizeResendPolicy(input = {}) {
  const enabled = input?.enabled !== false;
  const onlyAfterInbound = input?.onlyAfterInbound !== false;
  const parsedWindow = Number(input?.recentWindowHours);
  const recentWindowHours = Number.isFinite(parsedWindow)
    ? Math.max(1, Math.min(24 * 30, parsedWindow))
    : DEFAULT_RESEND_WINDOW_HOURS;
  return {
    enabled,
    onlyAfterInbound,
    recentWindowHours,
  };
}

function sanitizeAntiBanSettings(input = {}) {
  let minDelaySeconds = Number(input.minDelaySeconds);
  let maxDelaySeconds = Number(input.maxDelaySeconds);
  if (!Number.isFinite(minDelaySeconds))
    minDelaySeconds = DEFAULT_MIN_DELAY_SECONDS;
  if (!Number.isFinite(maxDelaySeconds))
    maxDelaySeconds = DEFAULT_MAX_DELAY_SECONDS;
  minDelaySeconds = Math.max(
    0,
    Math.min(minDelaySeconds, MAX_ALLOWED_DELAY_SECONDS),
  );
  maxDelaySeconds = Math.max(
    0,
    Math.min(maxDelaySeconds, MAX_ALLOWED_DELAY_SECONDS),
  );
  if (maxDelaySeconds < minDelaySeconds) {
    [minDelaySeconds, maxDelaySeconds] = [maxDelaySeconds, minDelaySeconds];
  }
  return {
    minDelaySeconds,
    maxDelaySeconds,
    deliveryWindow: sanitizeDeliveryWindow(input.deliveryWindow || {}),
    resendPolicy: sanitizeResendPolicy(input.resendPolicy || {}),
  };
}
function sanitizeMessageVariants(input, baseMessageTemplate) {
  const list = Array.isArray(input) ? input : [];
  const unique = [];
  const seen = new Set();
  list.forEach((value) => {
    const text = String(value || "").trim();
    if (!text) return;
    if (seen.has(text)) return;
    seen.add(text);
    unique.push(text);
  });
  const baseText = String(baseMessageTemplate || "").trim();
  if (baseText && !seen.has(baseText)) {
    unique.unshift(baseText);
  }
  return unique;
}
exports.createCampaign = async (req, res) => {
  try {
    const {
      name,
      messageTemplate,
      messageVariants = [],
      turboMode = false,
      contacts = [],
      media = null,
      antiBan = {},
      deliveryWindow = {},
      resendPolicy = {},
    } = req.body;
    const antiBanSettings = sanitizeAntiBanSettings({
      ...(antiBan || {}),
      deliveryWindow,
      resendPolicy,
    });
    const sanitizedVariants = sanitizeMessageVariants(
      messageVariants,
      messageTemplate,
    );
    const shouldRotateVariants = sanitizedVariants.length > 1;
    const campaign = new Campaign({
      name,
      agentId: req.agentId,
      messageTemplate,
      messageVariants: sanitizedVariants,
      turboMode: shouldRotateVariants,
      status: "running",
      antiBan: antiBanSettings,
      stats: {
        total: contacts.length,
        sent: 0,
        failed: 0,
      },
      media,
    });
    await campaign.save();
    
    const targetPhones = contacts.map(c => {
      const phoneNorm = normalizePhone(c.phone);
      return phoneNorm.normalized || String(c.phone || "").replace(/\D/g, "");
    }).filter(Boolean);
    
    const allMessages = await Message.find({
      $or: [
        { phone: { $in: targetPhones } },
        { phoneOriginal: { $in: targetPhones } }
      ]
    });
    
    const messagesByPhone = new Map();
    (Array.isArray(allMessages) ? allMessages : []).forEach((item) => {
      const phone = normalizePhone(item.phone || item.phoneOriginal).normalized;
      if (!phone) return;
      const list = messagesByPhone.get(phone) || [];
      list.push(item);
      messagesByPhone.set(phone, list);
    });

    const nowMs = Date.now();
    const resendWindowMs = Number(antiBanSettings.resendPolicy?.recentWindowHours || DEFAULT_RESEND_WINDOW_HOURS) * 60 * 60 * 1000;

    const messages = contacts.map((contact, index) => {
      const phoneNormalization = normalizePhone(contact.phone);
      const normalizedPhone =
        phoneNormalization.normalized ||
        String(contact.phone || "").replace(/\D/g, "");
      const existingByPhone = messagesByPhone.get(normalizedPhone) || [];
      const lastOutboundAt = existingByPhone
        .filter((item) => String(item.direction || "outbound") === "outbound" && String(item.status || "") === "sent")
        .map((item) => new Date(item.updatedAt || item.sentAt || item.createdAt || 0).getTime())
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => b - a)[0] || 0;
      const lastInboundAt = existingByPhone
        .filter((item) => String(item.direction || "outbound") === "inbound")
        .map((item) => new Date(item.updatedAt || item.sentAt || item.createdAt || 0).getTime())
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => b - a)[0] || 0;
      const withinRecentWindow = lastOutboundAt > 0 && (nowMs - lastOutboundAt) <= resendWindowMs;
      const shouldBlockResend = Boolean(
        antiBanSettings.resendPolicy?.enabled
        && antiBanSettings.resendPolicy?.onlyAfterInbound
        && withinRecentWindow
        && (!lastInboundAt || lastInboundAt <= lastOutboundAt),
      );
      const template = shouldRotateVariants ? sanitizedVariants[index % sanitizedVariants.length] : messageTemplate || sanitizedVariants[0] || "";
      return {
        campaign: campaign._id,
        phone: normalizedPhone,
        phoneOriginal: String(contact.phone || ""),
        searchTerms: phoneNormalization.searchTerms,
        name: contact.name,
        variables: contact.variables,
        processedMessage: String(template || "").replace(
          /{name}/g,
          contact.name || "",
        ),
        status: shouldBlockResend ? "failed" : "pending",
        attemptCount: 0,
        lastError: shouldBlockResend
          ? "Reenvio bloqueado: contato recebeu mensagem recente sem interação posterior."
          : null,
        audit: [
          {
            at: new Date(),
            action: shouldBlockResend ? "blocked_by_resend_policy" : "queued",
            details: shouldBlockResend
              ? "Message blocked by resend policy (no inbound after last outbound in recent window)."
              : "Message added to queue",
          },
        ],
        updatedAt: new Date(),
      };
    });
    const blockedCount = messages.filter((item) => item.status === "failed").length;
    if (blockedCount > 0) {
      campaign.stats.failed = (campaign.stats.failed || 0) + blockedCount;
      await campaign.save();
    }
    if (messages.length > 0) {
      await Message.insertMany(messages);
    }
    emitRealtimeEvent("campaign.created", {
      campaign: {
        _id: campaign._id,
        name: campaign.name,
        status: campaign.status,
        stats: campaign.stats,
        createdAt: campaign.createdAt,
      },
      queuedMessages: messages.length,
    });
    emitRealtimeEvent("campaign.messages.queued", {
      campaignId: campaign._id,
      count: messages.length,
    });
    res.status(201).json(campaign);
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};
exports.getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ agentId: req.agentId }).sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};
exports.getCampaignFailures = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ _id: req.params.id, agentId: req.agentId });
    const campaign = campaigns && campaigns.length > 0 ? campaigns[0] : null;
    if (!campaign) {
      return res.status(404).json({ msg: "Campaign not found" });
    }
    const failures = await Message.find({
      campaign: req.params.id,
      status: "failed",
    });
    const orderedFailures = [...failures].sort((a, b) => {
      const aDate = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bDate = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bDate - aDate;
    });
    res.json({
      campaign: {
        _id: campaign._id,
        name: campaign.name,
        status: campaign.status,
        stats: campaign.stats,
      },
      failures: orderedFailures,
    });
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};

exports.updateCampaign = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ _id: req.params.id, agentId: req.agentId });
    const campaign = campaigns && campaigns.length > 0 ? campaigns[0] : null;
    if (!campaign) {
      return res.status(404).json({ msg: "Campaign not found or unauthorized" });
    }

    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, "name");
    const hasMessage = Object.prototype.hasOwnProperty.call(req.body || {}, "messageTemplate");
    const hasAntiBan = Object.prototype.hasOwnProperty.call(req.body || {}, "antiBan");
    const hasMedia = Object.prototype.hasOwnProperty.call(req.body || {}, "media");

    if (hasName) {
      const nextName = String(req.body.name || "").trim();
      if (!nextName) {
        return res.status(400).json({ msg: "Campaign name is required" });
      }
      campaign.name = nextName;
    }

    let nextTemplate = String(campaign.messageTemplate || "");
    if (hasMessage) {
      nextTemplate = String(req.body.messageTemplate || "").trim();
      campaign.messageTemplate = nextTemplate;
    }

    if (hasAntiBan) {
      const existing = campaign.antiBan || {};
      const incoming = req.body.antiBan || {};
      campaign.antiBan = sanitizeAntiBanSettings({
        ...existing,
        ...incoming,
        deliveryWindow: incoming.deliveryWindow || existing.deliveryWindow || {},
        resendPolicy: incoming.resendPolicy || existing.resendPolicy || {},
      });
    }

    if (hasMedia) {
      campaign.media = req.body.media || null;
    }

    campaign.updatedAt = new Date();
    const updatedCampaign = await Campaign.findByIdAndUpdate(campaign._id, campaign);

    if (hasMessage) {
      const pendingMessages = await Message.find({ campaign: campaign._id, status: "pending" });
      const toUpdate = Array.isArray(pendingMessages) ? pendingMessages : [];
      for (const item of toUpdate) {
        const messageDoc = await Message.findById(item._id);
        if (!messageDoc || messageDoc.status !== "pending") continue;
        messageDoc.processedMessage = nextTemplate.replace(
          /{name}/g,
          String(messageDoc.name || ""),
        );
        messageDoc.updatedAt = new Date();
        messageDoc.audit = Array.isArray(messageDoc.audit) ? messageDoc.audit : [];
        messageDoc.audit.push({
          at: new Date(),
          action: "campaign_updated",
          details: "Message template refreshed after campaign update.",
        });
        await messageDoc.save();
      }
    }

    emitRealtimeEvent("campaign.updated", {
      campaignId: campaign._id,
      name: updatedCampaign?.name || campaign.name,
      updatedAt: new Date().toISOString(),
    });

    return res.json(updatedCampaign || campaign);
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};

exports.dispatchNextCampaignContact = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ _id: req.params.id, agentId: req.agentId });
    const campaign = campaigns && campaigns.length > 0 ? campaigns[0] : null;
    if (!campaign) {
      return res.status(404).json({ msg: "Campaign not found or unauthorized" });
    }

    const pendingMessages = await Message.find({
      campaign: campaign._id,
      status: "pending",
    });
    const ordered = (Array.isArray(pendingMessages) ? pendingMessages : []).sort((a, b) => {
      const aDate = new Date(a.createdAt || a.updatedAt || 0).getTime();
      const bDate = new Date(b.createdAt || b.updatedAt || 0).getTime();
      return aDate - bDate;
    });

    const nextMessage = ordered[0] || null;
    if (!nextMessage) {
      return res.status(400).json({ msg: "No pending contacts in queue." });
    }

    const messageDoc = await Message.findById(nextMessage._id);
    if (!messageDoc || messageDoc.status !== "pending") {
      return res.status(409).json({ msg: "Pending message no longer available." });
    }

    messageDoc.attemptCount = -1;
    messageDoc.updatedAt = new Date();
    messageDoc.audit = Array.isArray(messageDoc.audit) ? messageDoc.audit : [];
    messageDoc.audit.push({
      at: new Date(),
      action: "expedite_next",
      details: "Message promoted to immediate dispatch by user action.",
      meta: {
        requestedBy: req.agentId || "unknown",
      },
    });
    await messageDoc.save();

    const botCommand = enqueueBotCommand(req.agentId, {
      type: "skip_delay_once",
      payload: {
        reason: "dispatch_next_contact_now",
        campaignId: String(campaign._id || ""),
        messageId: String(messageDoc._id || ""),
      },
      requestedBy: req.agentId || "system",
    });

    emitRealtimeEvent("messages.queue.expedited", {
      messageId: messageDoc._id,
      campaignId: campaign._id,
      phone: messageDoc.phone || "",
      requestedBy: req.agentId || "unknown",
      commandId: botCommand?.id || null,
      updatedAt: messageDoc.updatedAt,
    });

    return res.json({
      success: true,
      campaignId: campaign._id,
      messageId: messageDoc._id,
      commandId: botCommand?.id || null,
    });
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};

exports.retryCampaignFailures = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ _id: req.params.id, agentId: req.agentId });
    const campaign = campaigns && campaigns.length > 0 ? campaigns[0] : null;
    if (!campaign) {
      return res.status(404).json({ msg: "Campaign not found or unauthorized" });
    }

    const failedMessages = await Message.find({
      campaign: campaign._id,
      status: "failed",
    });
    const failedList = Array.isArray(failedMessages) ? failedMessages : [];
    if (failedList.length === 0) {
      return res.json({ success: true, campaignId: campaign._id, retriedCount: 0 });
    }

    const now = new Date();
    const requestedBy = req.agentId || "unknown";
    const bulkOps = failedList.map((item) => ({
      updateOne: {
        filter: { _id: item._id, status: "failed" },
        update: {
          $set: {
            status: "pending",
            error: null,
            lastError: null,
            sentAt: null,
            updatedAt: now,
          },
          $push: {
            audit: {
              at: now,
              action: "retried_bulk",
              details: "Message moved back to queue by bulk retry action.",
              meta: { requestedBy },
            },
          },
        },
      },
    }));

    const bulkResult = await Message.bulkWrite(bulkOps, { ordered: false });
    const retriedCount = Number(
      bulkResult?.modifiedCount
      ?? bulkResult?.nModified
      ?? 0,
    );

    if (!campaign.stats || typeof campaign.stats !== "object") {
      campaign.stats = { total: 0, sent: 0, failed: 0 };
    }
    campaign.stats.failed = Math.max(0, Number(campaign.stats.failed || 0) - retriedCount);
    campaign.updatedAt = now;
    await campaign.save();

    emitRealtimeEvent("messages.retried.bulk", {
      campaignId: campaign._id,
      retriedCount,
      requestedBy,
      updatedAt: now,
    });
    emitRealtimeEvent("campaign.stats.updated", {
      campaignId: campaign._id,
      stats: campaign.stats,
      updatedAt: campaign.updatedAt,
    });

    return res.json({
      success: true,
      campaignId: campaign._id,
      retriedCount,
    });
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ _id: req.params.id, agentId: req.agentId });
    const campaign = campaigns && campaigns.length > 0 ? campaigns[0] : null;
    if (!campaign) {
      return res.status(404).json({ msg: "Campaign not found or unauthorized" });
    }
    await Message.deleteMany({ campaign: req.params.id });
    await Campaign.deleteById(req.params.id);
    emitRealtimeEvent("campaign.deleted", {
      campaignId: req.params.id,
      name: campaign.name || "",
    });
    res.json({ msg: "Campaign removed" });
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};
