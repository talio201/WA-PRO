const Campaign = require("../models/Campaign");
const Message = require("../models/Message");
const { normalizePhone } = require("../utils/phone");
const { buildServerErrorResponse } = require("../utils/httpError");
const { emitRealtimeEvent } = require("../realtime/realtime");
const DEFAULT_MIN_DELAY_SECONDS = 0;
const DEFAULT_MAX_DELAY_SECONDS = 120;
const MAX_ALLOWED_DELAY_SECONDS = 3600;
const DEFAULT_RESEND_WINDOW_HOURS = 72;

function resolveOwnerId(req) {
  return String(req.user?.id || req.agentId || "").trim();
}

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

function appendAudit(message, action, details, meta = {}) {
  if (!Array.isArray(message.audit)) {
    message.audit = [];
  }
  message.audit.push({
    at: new Date(),
    action,
    details,
    meta,
  });
}

async function findOwnedCampaign(campaignId, ownerId) {
  const campaigns = await Campaign.find({ _id: campaignId, agentId: ownerId });
  return Array.isArray(campaigns) && campaigns.length > 0 ? campaigns[0] : null;
}
exports.createCampaign = async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    if (!ownerId || ownerId === "bot") {
      return res.status(403).json({ msg: "Unauthorized owner for campaign." });
    }
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
    const shouldRotateVariants =
      Boolean(turboMode) && sanitizedVariants.length > 1;
    const campaign = new Campaign({
      name,
      agentId: ownerId,
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
    const allMessages = await Message.find({ agentId: ownerId });
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
      const template = shouldRotateVariants
        ? sanitizedVariants[
            Math.floor(Math.random() * sanitizedVariants.length)
          ]
        : messageTemplate || sanitizedVariants[0] || "";
      return {
        agentId: ownerId,
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
    const ownerId = resolveOwnerId(req);
    const campaigns = await Campaign.find({ agentId: ownerId }).sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};
exports.getCampaignFailures = async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const campaigns = await Campaign.find({ _id: req.params.id, agentId: ownerId });
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
exports.deleteCampaign = async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const campaigns = await Campaign.find({ _id: req.params.id, agentId: ownerId });
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
exports.updateCampaign = async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const campaign = await findOwnedCampaign(req.params.id, ownerId);
    if (!campaign) {
      return res.status(404).json({ msg: "Campaign not found or unauthorized" });
    }

    const payload = req.body || {};
    const nextName =
      payload.name !== undefined ? String(payload.name || "").trim() : campaign.name;
    const nextTemplate =
      payload.messageTemplate !== undefined
        ? String(payload.messageTemplate || "")
        : campaign.messageTemplate;
    const providedVariants = payload.messageVariants !== undefined
      ? payload.messageVariants
      : campaign.messageVariants;
    const nextVariants = sanitizeMessageVariants(providedVariants, nextTemplate);
    const nextTurboMode =
      payload.turboMode !== undefined
        ? Boolean(payload.turboMode)
        : Boolean(campaign.turboMode);

    const nextStatus = payload.status !== undefined
      ? String(payload.status || '').trim().toLowerCase()
      : campaign.status;
    const allowedStatuses = ["draft", "running", "paused", "completed", "archived"];
    if (payload.status !== undefined && !allowedStatuses.includes(nextStatus)) {
      return res.status(400).json({ msg: `Invalid status. Allowed: ${allowedStatuses.join(", ")}` });
    }

    const antiBanInput = {
      ...(campaign.antiBan || {}),
      ...(payload.antiBan || {}),
      deliveryWindow:
        payload.deliveryWindow !== undefined
          ? payload.deliveryWindow
          : payload.antiBan?.deliveryWindow !== undefined
            ? payload.antiBan.deliveryWindow
            : campaign.antiBan?.deliveryWindow || {},
      resendPolicy:
        payload.resendPolicy !== undefined
          ? payload.resendPolicy
          : payload.antiBan?.resendPolicy !== undefined
            ? payload.antiBan.resendPolicy
            : campaign.antiBan?.resendPolicy || {},
    };

    const updatePayload = {
      name: nextName,
      messageTemplate: nextTemplate,
      messageVariants: nextVariants,
      turboMode: nextTurboMode && nextVariants.length > 1,
      antiBan: sanitizeAntiBanSettings(antiBanInput),
      status: nextStatus,
      updatedAt: new Date(),
    };

    const updatedCampaign = await Campaign.findByIdAndUpdate(
      campaign._id,
      updatePayload,
    );

    emitRealtimeEvent("campaign.updated", {
      campaignId: campaign._id,
      campaign: updatedCampaign,
      updatedAt: updatePayload.updatedAt,
    });

    res.json(updatedCampaign || { ...campaign, ...updatePayload });
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};
exports.dispatchNextCampaignContact = async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const campaign = await findOwnedCampaign(req.params.id, ownerId);
    if (!campaign) {
      return res.status(404).json({ msg: "Campaign not found or unauthorized" });
    }

    const pending = await Message.find({
      campaign: campaign._id,
      status: "pending",
    });
    const queue = (Array.isArray(pending) ? pending : []).sort((a, b) => {
      const aDate = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bDate = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return aDate - bDate;
    });

    const next = queue[0];
    if (!next) {
      return res.status(404).json({ msg: "No pending contacts in this campaign." });
    }

    const message = await Message.findById(next._id);
    if (!message) {
      return res.status(404).json({ msg: "Message not found." });
    }

    message.attemptCount = -1;
    message.updatedAt = new Date();
    appendAudit(
      message,
      "manual_priority_dispatch",
      "Message promoted for immediate dispatch",
      { campaignId: campaign._id },
    );
    await message.save();

    emitRealtimeEvent("campaign.dispatch.next", {
      campaignId: campaign._id,
      messageId: message._id,
      phone: message.phone || "",
      updatedAt: message.updatedAt,
    });

    res.json({
      msg: "Next contact dispatched successfully.",
      campaignId: campaign._id,
      messageId: message._id,
    });
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};
exports.retryCampaignFailures = async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const campaign = await findOwnedCampaign(req.params.id, ownerId);
    if (!campaign) {
      return res.status(404).json({ msg: "Campaign not found or unauthorized" });
    }

    const failures = await Message.find({
      campaign: campaign._id,
      status: "failed",
    });
    const list = Array.isArray(failures) ? failures : [];

    let retriedCount = 0;
    for (const item of list) {
      if (!item?._id) continue;
      const message = await Message.findById(item._id);
      if (!message || message.status !== "failed") continue;
      const previousStatus = message.status;
      message.status = "pending";
      message.error = null;
      message.lastError = null;
      message.sentAt = null;
      message.updatedAt = new Date();
      appendAudit(message, "retried_bulk", "Message moved back to queue", {
        previousStatus,
        campaignId: campaign._id,
      });
      await message.save();
      retriedCount += 1;
    }

    const currentStats = campaign.stats || { total: 0, sent: 0, failed: 0 };
    const nextFailed = Math.max(0, Number(currentStats.failed || 0) - retriedCount);
    const updatedCampaign = await Campaign.findByIdAndUpdate(campaign._id, {
      stats: {
        ...currentStats,
        failed: nextFailed,
      },
      updatedAt: new Date(),
    });

    emitRealtimeEvent("campaign.failures.retried", {
      campaignId: campaign._id,
      retriedCount,
      stats: updatedCampaign?.stats || currentStats,
    });

    res.json({
      campaignId: campaign._id,
      retriedCount,
    });
  } catch (err) {
    console.error(err.message);
    const errorResponse = buildServerErrorResponse(err);
    res.status(errorResponse.statusCode).json(errorResponse.body);
  }
};
