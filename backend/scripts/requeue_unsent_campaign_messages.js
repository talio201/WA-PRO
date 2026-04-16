#!/usr/bin/env node
require("dotenv").config();

const Message = require("../src/models/Message");
const Campaign = require("../src/models/Campaign");

function parseArgs(argv) {
  const args = {
    apply: false,
    agentId: null,
    campaignIds: [],
    staleMinutes: Number(process.env.STALE_PROCESSING_TIMEOUT_MS || 90000) / 60000,
    includePaused: false,
    includeFailed: true,
    includeBlockedResend: false,
    includeInvalidNumber: false,
    resumePaused: false,
  };

  for (const token of argv.slice(2)) {
    if (token === "--apply") args.apply = true;
    else if (token === "--include-paused") args.includePaused = true;
    else if (token === "--no-failed") args.includeFailed = false;
    else if (token === "--include-blocked-resend") args.includeBlockedResend = true;
    else if (token === "--include-invalid-number") args.includeInvalidNumber = true;
    else if (token === "--resume-paused") args.resumePaused = true;
    else if (token.startsWith("--agent-id=")) args.agentId = String(token.split("=").slice(1).join("=") || "").trim() || null;
    else if (token.startsWith("--campaign-id=")) {
      const id = String(token.split("=").slice(1).join("=") || "").trim();
      if (id) args.campaignIds.push(id);
    } else if (token.startsWith("--stale-minutes=")) {
      const parsed = Number(token.split("=").slice(1).join("="));
      if (Number.isFinite(parsed) && parsed > 0) args.staleMinutes = parsed;
    }
  }

  if (!Number.isFinite(args.staleMinutes) || args.staleMinutes <= 0) {
    args.staleMinutes = 1.5;
  }

  args.campaignIds = Array.from(new Set(args.campaignIds));
  return args;
}

function isRetryableFailure(message, options) {
  const reason = String(message?.lastError || message?.error || "").toLowerCase();

  if (!reason) return true;

  if (!options.includeBlockedResend && reason.includes("reenvio bloqueado")) {
    return false;
  }

  if (!options.includeInvalidNumber) {
    const invalidHints = ["número inválido", "numero invalido", "invalid", "sem whatsapp"];
    if (invalidHints.some((hint) => reason.includes(hint))) {
      return false;
    }
  }

  return true;
}

function buildCampaignQuery(options) {
  const query = {};

  if (options.campaignIds.length > 0) {
    query._id = { $in: options.campaignIds };
  }

  if (options.agentId) {
    query.agentId = options.agentId;
  }

  if (options.includePaused) {
    query.status = { $in: ["running", "paused"] };
  } else {
    query.status = "running";
  }

  return query;
}

async function main() {
  const options = parseArgs(process.argv);
  const staleMs = Math.round(options.staleMinutes * 60 * 1000);
  const now = Date.now();

  const campaigns = await Campaign.find(buildCampaignQuery(options));
  const campaignList = Array.isArray(campaigns) ? campaigns : [];

  if (campaignList.length === 0) {
    console.log("Nenhuma campanha elegivel encontrada.");
    process.exit(0);
  }

  const campaignMap = new Map(campaignList.map((item) => [String(item._id), item]));
  const campaignIds = Array.from(campaignMap.keys());
  const allMessages = await Message.find({ campaign: { $in: campaignIds } });
  const messageList = Array.isArray(allMessages) ? allMessages : [];

  let pendingAlready = 0;
  let requeueFromFailed = 0;
  let requeueFromProcessing = 0;
  let skippedBlockedPolicy = 0;
  let skippedInvalid = 0;
  let affectedCampaigns = 0;

  const toRequeue = [];
  const failedByCampaign = new Map();

  for (const msg of messageList) {
    const status = String(msg?.status || "").toLowerCase();

    if (status === "sent") continue;

    if (status === "pending") {
      pendingAlready += 1;
      continue;
    }

    if (status === "processing") {
      const reference = new Date(
        msg.lastAttemptAt || msg.updatedAt || msg.createdAt || 0,
      ).getTime();
      const isStale = !Number.isFinite(reference) || reference <= 0 || (now - reference) > staleMs;
      if (isStale) {
        toRequeue.push({ message: msg, reason: "stale_processing" });
        requeueFromProcessing += 1;
      }
      continue;
    }

    if (status === "failed" && options.includeFailed) {
      const retryable = isRetryableFailure(msg, options);
      if (retryable) {
        toRequeue.push({ message: msg, reason: "failed_retry" });
        requeueFromFailed += 1;
        const campaignId = String(msg.campaign || "");
        if (campaignId) {
          failedByCampaign.set(campaignId, (failedByCampaign.get(campaignId) || 0) + 1);
        }
      } else {
        const reason = String(msg?.lastError || msg?.error || "").toLowerCase();
        if (reason.includes("reenvio bloqueado")) skippedBlockedPolicy += 1;
        else skippedInvalid += 1;
      }
    }
  }

  const campaignTouched = new Set(toRequeue.map((entry) => String(entry.message.campaign || "")).filter(Boolean));
  affectedCampaigns = campaignTouched.size;

  if (options.resumePaused && options.apply) {
    for (const campaignId of campaignTouched) {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign) continue;
      if (String(campaign.status || "") === "paused") {
        campaign.status = "running";
        campaign.updatedAt = new Date();
        await campaign.save();
      }
    }
  }

  if (options.apply) {
    for (const entry of toRequeue) {
      const current = await Message.findById(entry.message._id);
      if (!current) continue;

      const previousStatus = String(current.status || "").toLowerCase();
      if (previousStatus === "sent" || previousStatus === "pending") continue;

      current.status = "pending";
      current.error = null;
      current.lastError = null;
      current.sentAt = null;
      current.updatedAt = new Date();
      current.audit = Array.isArray(current.audit) ? current.audit : [];
      current.audit.push({
        at: new Date(),
        action: "surgical_requeue",
        details: "Message moved back to pending queue by recovery script.",
        meta: {
          reason: entry.reason,
          script: "backend/scripts/requeue_unsent_campaign_messages.js",
        },
      });
      await current.save();
    }

    for (const [campaignId, reducedFailures] of failedByCampaign.entries()) {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign) continue;
      campaign.stats = campaign.stats || { total: 0, sent: 0, failed: 0 };
      campaign.stats.failed = Math.max(0, Number(campaign.stats.failed || 0) - reducedFailures);
      campaign.updatedAt = new Date();
      await campaign.save();
    }
  }

  console.log("--- RECOVERY SUMMARY ---");
  console.log(`Modo: ${options.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Campanhas analisadas: ${campaignList.length}`);
  console.log(`Mensagens pendentes ja preservadas: ${pendingAlready}`);
  console.log(`Mensagens para requeue (processing travado): ${requeueFromProcessing}`);
  console.log(`Mensagens para requeue (failed): ${requeueFromFailed}`);
  console.log(`Puladas por politica de reenvio: ${skippedBlockedPolicy}`);
  console.log(`Puladas por numero invalido/erro definitivo: ${skippedInvalid}`);
  console.log(`Campanhas afetadas: ${affectedCampaigns}`);

  if (!options.apply) {
    console.log("\nNenhuma alteracao foi gravada. Rode novamente com --apply para efetivar.");
  }
}

main().catch((error) => {
  console.error("Falha ao executar recuperacao:", error?.message || error);
  process.exit(1);
});
