const { supabaseAdmin } = require("../config/supabase");

class CampaignModel {
  constructor(data = {}) {
    Object.assign(this, data);
  }

  static fromDb(row) {
    if (!row) return null;
    const model = new CampaignModel({
      id: row.id,
      _id: row.id, // Compatibility with existing code expecting _id
      agentId: row.agent_id,
      tenantId: row.tenant_id,
      name: row.name,
      messageTemplate: row.message_template,
      messageVariants: row.message_variants,
      turboMode: row.turbo_mode,
      status: row.status,
      antiBan: row.anti_ban,
      stats: row.stats,
      media: row.media,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });

    model.save = async function saveCampaign() {
      const payload = {
        name: model.name,
        message_template: model.message_template || model.messageTemplate,
        message_variants: model.message_variants || model.messageVariants,
        turbo_mode: model.turbo_mode || model.turboMode,
        status: model.status,
        anti_ban: model.anti_ban || model.antiBan,
        stats: model.stats,
        media: model.media,
        agent_id: model.agent_id || model.agentId,
        tenant_id: model.tenant_id || model.tenantId
      };
      const { data: updated, error } = await supabaseAdmin
        .from("campaigns")
        .update(payload)
        .eq("id", model.id)
        .select()
        .single();
      
      if (error) throw error;
      Object.assign(model, CampaignModel.fromDb(updated));
      return model;
    };

    return model;
  }

  async save() {
    const payload = {
      agent_id: this.agentId,
      tenant_id: this.tenantId || this.agentId,
      name: this.name,
      message_template: this.messageTemplate,
      message_variants: this.messageVariants || [],
      turbo_mode: !!this.turboMode,
      status: this.status || 'running',
      anti_ban: this.antiBan || { minDelaySeconds: 0, maxDelaySeconds: 120 },
      stats: this.stats || { total: 0, sent: 0, failed: 0 },
      media: this.media || null
    };

    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    Object.assign(this, CampaignModel.fromDb(data));
    return this;
  }

  static async find(query = {}) {
    let q = supabaseAdmin.from("campaigns").select("*");
    
    if (query.agentId) {
      if (typeof query.agentId === 'object' && query.agentId.$like) {
        q = q.ilike("agent_id", query.agentId.$like.replace('%', '*'));
      } else {
        q = q.eq("agent_id", query.agentId);
      }
    }
    if (query.tenantId) q = q.eq("tenant_id", query.tenantId);
    if (query.status) q = q.eq("status", query.status);
    if (query._id) q = q.eq("id", query._id);
    if (query.id) q = q.eq("id", query.id);

    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(row => CampaignModel.fromDb(row));
  }

  static async findById(id) {
    if (!id) return null;
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .single();
    
    if (error || !data) return null;
    return CampaignModel.fromDb(data);
  }

  static async findByIdAndUpdate(id, update) {
    const payload = {};
    if (update.name !== undefined) payload.name = update.name;
    if (update.status !== undefined) payload.status = update.status;
    if (update.stats !== undefined) payload.stats = update.stats;
    if (update.antiBan !== undefined) payload.anti_ban = update.antiBan;
    if (update.messageTemplate !== undefined) payload.message_template = update.messageTemplate;
    if (update.messageVariants !== undefined) payload.message_variants = update.messageVariants;
    if (update.turboMode !== undefined) payload.turbo_mode = update.turboMode;
    if (update.media !== undefined) payload.media = update.media;

    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    
    if (error) throw error;
    return CampaignModel.fromDb(data);
  }

  static async deleteMany(query = {}) {
    let q = supabaseAdmin.from("campaigns").delete();
    if (query.agentId) q = q.eq("agent_id", query.agentId);
    if (query.tenantId) q = q.eq("tenant_id", query.tenantId);
    const { error } = await q;
    if (error) throw error;
    return true;
  }

  static async deleteById(id) {
    const { error } = await supabaseAdmin
      .from("campaigns")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return true;
  }
}

module.exports = CampaignModel;
