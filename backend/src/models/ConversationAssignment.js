const { supabaseAdmin } = require("../config/supabase");

class ConversationAssignmentModel {
  constructor(data = {}) {
    Object.assign(this, data);
  }

  static fromDb(row) {
    if (!row) return null;
    return new ConversationAssignmentModel({
      id: row.id,
      _id: row.id,
      tenantId: row.tenant_id,
      phone: row.phone,
      campaignId: row.campaign_id,
      assignedTo: row.assigned_to,
      assignedBy: row.assigned_by,
      status: row.status,
      assignedAt: row.assigned_at,
      lastInboundAt: row.last_inbound_at,
      closedAt: row.closed_at,
      notes: row.notes,
      updatedAt: row.updated_at
    });
  }

  async save() {
    const payload = {
      tenant_id: this.tenantId,
      phone: this.phone || "",
      campaign_id: this.campaignId || null,
      assigned_to: this.assignedTo || "",
      assigned_by: this.assignedBy || "",
      status: this.status || "active",
      assigned_at: this.assignedAt || new Date(),
      last_inbound_at: this.lastInboundAt || null,
      closed_at: this.closedAt || null,
      notes: this.notes || ""
    };

    if (this.id || this._id) {
      const id = this.id || this._id;
      const { data, error } = await supabaseAdmin
        .from("conversation_assignments")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      Object.assign(this, ConversationAssignmentModel.fromDb(data));
      return this;
    }

    const { data, error } = await supabaseAdmin
      .from("conversation_assignments")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    Object.assign(this, ConversationAssignmentModel.fromDb(data));
    return this;
  }

  static async find(query = {}) {
    let q = supabaseAdmin.from("conversation_assignments").select("*");
    if (query.tenantId) q = q.eq("tenant_id", query.tenantId);
    if (query.phone) q = q.eq("phone", query.phone);
    if (query.status) q = q.eq("status", query.status);

    const { data, error } = await q.order("assigned_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ConversationAssignmentModel.fromDb(row));
  }

  static async findById(id) {
    if (!id) return null;
    const { data, error } = await supabaseAdmin
      .from("conversation_assignments")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    const model = ConversationAssignmentModel.fromDb(data);
    
    model.save = async function saveConversationAssignment() {
      return model.save();
    };
    return model;
  }
}

module.exports = ConversationAssignmentModel;
