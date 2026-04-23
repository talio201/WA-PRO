const { supabaseAdmin } = require("../config/supabase");

class MessageModel {
  constructor(data = {}) {
    Object.assign(this, data);
  }

  static fromDb(row) {
    if (!row) return null;
    const model = new MessageModel({
      id: row.id,
      _id: row.id,
      agentId: row.agent_id,
      tenantId: row.tenant_id,
      campaignId: row.campaign_id,
      campaign: row.campaign_id, // Compatibility
      phone: row.phone,
      phoneOriginal: row.phone_original,
      searchTerms: row.search_terms,
      name: row.name,
      variables: row.variables,
      processedMessage: row.processed_message,
      status: row.status,
      direction: row.direction,
      attemptCount: row.attempt_count,
      error: row.error,
      lastError: row.last_error,
      audit: row.audit,
      sentAt: row.sent_at,
      lastAttemptAt: row.last_attempt_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });

    model.save = async function saveMessage() {
      const payload = {
        agent_id: model.agentId,
        tenant_id: model.tenantId,
        campaign_id: model.campaignId || model.campaign,
        phone: model.phone,
        phone_original: model.phoneOriginal,
        search_terms: model.searchTerms,
        name: model.name,
        variables: model.variables,
        processed_message: model.processedMessage,
        status: model.status,
        direction: model.direction,
        attempt_count: model.attemptCount,
        error: model.error,
        last_error: model.lastError,
        audit: model.audit,
        sent_at: model.sentAt,
        last_attempt_at: model.lastAttemptAt
      };
      const { data: updated, error } = await supabaseAdmin
        .from("messages")
        .update(payload)
        .eq("id", model.id)
        .select()
        .single();
      
      if (error) throw error;
      Object.assign(model, MessageModel.fromDb(updated));
      return model;
    };

    return model;
  }

  static async insertMany(items) {
    const payloads = items.map(item => ({
      agent_id: item.agentId || item.agent_id,
      tenant_id: item.tenantId || item.tenant_id || item.agentId || item.agent_id,
      campaign_id: item.campaignId || item.campaign,
      phone: item.phone,
      phone_original: item.phoneOriginal || item.phone_original,
      search_terms: item.searchTerms || item.search_terms || [],
      name: item.name,
      variables: item.variables || {},
      processed_message: item.processedMessage || item.processed_message || '',
      status: item.status || 'pending',
      direction: item.direction || 'outbound',
      attempt_count: item.attemptCount || item.attempt_count || 0,
      audit: item.audit || []
    }));

    const { data, error } = await supabaseAdmin
      .from("messages")
      .insert(payloads)
      .select();

    if (error) throw error;
    return (data || []).map(row => MessageModel.fromDb(row));
  }

  static async find(query = {}) {
    let q = supabaseAdmin.from("messages").select("*");
    
    if (query.agentId) q = q.eq("agent_id", query.agentId);
    if (query.tenantId) q = q.eq("tenant_id", query.tenantId);
    
    // Handle campaign filtering with $in support
    if (query.campaign) {
      if (query.campaign.$in) {
        q = q.in("campaign_id", query.campaign.$in);
      } else {
        q = q.eq("campaign_id", query.campaign);
      }
    } else if (query.campaignId) {
      q = q.eq("campaign_id", query.campaignId);
    }

    if (query.status) {
      if (query.status.$in) {
        q = q.in("status", query.status.$in);
      } else {
        q = q.eq("status", query.status);
      }
    }
    if (query.phone) q = q.eq("phone", query.phone);
    if (query._id) q = q.eq("id", query._id);

    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(row => MessageModel.fromDb(row));
  }

  static findOneAndUpdate(query, update, options) {
    const operation = (async () => {
      let q = supabaseAdmin.from("messages").select("*");
      if (query.agentId) q = q.eq("agent_id", query.agentId);
      
      if (query.campaign) {
        if (query.campaign.$in) q = q.in("campaign_id", query.campaign.$in);
        else q = q.eq("campaign_id", query.campaign);
      }
      
      if (query.status) q = q.eq("status", query.status);
      if (query._id) q = q.eq("id", query._id);
      if (query.attemptCount !== undefined) q = q.eq("attempt_count", query.attemptCount);

      const { data: results } = await q.limit(1);
      const existing = results && results.length > 0 ? results[0] : null;
      if (!existing) return null;

      const payload = {};
      if (update.status) payload.status = update.status;
      if (update.error !== undefined) payload.error = update.error;
      if (update.sentAt) payload.sent_at = update.sentAt;
      if (update.processedMessage) payload.processed_message = update.processedMessage;
      if (update.$inc && update.$inc.attemptCount) payload.attempt_count = (existing.attempt_count || 0) + update.$inc.attemptCount;
      if (update.attemptCount !== undefined) payload.attempt_count = update.attemptCount;

      const { data: updated, error } = await supabaseAdmin
        .from("messages")
        .update(payload)
        .eq("id", existing.id)
        .select()
        .single();
      
      if (error) throw error;
      return MessageModel.fromDb(updated);
    })();

    const buildThenable = (promise) => ({
      then: (onFulfilled, onRejected) => promise.then(onFulfilled, onRejected),
      catch: (onRejected) => promise.catch(onRejected),
    });

    return {
      populate: (field, selectExpression = "") => {
        const populated = operation.then(async (doc) => {
          if (!doc || field !== "campaign") return doc;
          const Campaign = require("./Campaign");
          const campaign = await Campaign.findById(doc.campaignId || doc.campaign);
          if (!campaign) {
            doc.campaign = null;
            return doc;
          }
          // Simple projection logic
          doc.campaign = campaign;
          return doc;
        });
        return buildThenable(populated);
      },
      then: (onFulfilled, onRejected) => operation.then(onFulfilled, onRejected),
      catch: (onRejected) => operation.catch(onRejected),
    };
  }

  static async findById(id) {
    if (!id) return null;
    const { data, error } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("id", id)
      .single();
    
    if (error || !data) return null;
    return MessageModel.fromDb(data);
  }

  static async deleteMany(query = {}) {
    let q = supabaseAdmin.from("messages").delete();
    if (query.agentId) q = q.eq("agent_id", query.agentId);
    if (query.tenantId) q = q.eq("tenant_id", query.tenantId);
    if (query.campaignId) q = q.eq("campaign_id", query.campaignId);
    if (query.campaign) q = q.eq("campaign_id", query.campaign);
    
    const { error } = await q;
    if (error) throw error;
    return true;
  }
}

module.exports = MessageModel;
