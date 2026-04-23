const { supabaseAdmin } = require("../config/supabase");

class SupportProtocolModel {
  constructor(data = {}) {
    Object.assign(this, data);
  }

  static fromDb(row) {
    if (!row) return null;
    return new SupportProtocolModel({
      id: row.id,
      _id: row.id,
      tenantId: row.tenant_id,
      phone: row.phone,
      campaignId: row.campaign_id,
      protocolNumber: row.protocol_number,
      customerName: row.customer_name,
      subject: row.subject,
      description: row.description,
      priority: row.priority,
      status: row.status,
      assignedTo: row.assigned_to,
      openedBy: row.opened_by,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      metadata: row.metadata,
      updatedAt: row.updated_at
    });
  }

  async save() {
    const payload = {
      tenant_id: this.tenantId,
      phone: this.phone || "",
      campaign_id: this.campaignId || null,
      protocol_number: this.protocolNumber || "",
      customer_name: this.customerName || "",
      subject: this.subject || "",
      description: this.description || "",
      priority: this.priority || "normal",
      status: this.status || "open",
      assigned_to: this.assignedTo || "",
      opened_by: this.openedBy || "",
      opened_at: this.openedAt || new Date(),
      closed_at: this.closedAt || null,
      metadata: this.metadata || {}
    };

    if (this.id || this._id) {
      const id = this.id || this._id;
      const { data, error } = await supabaseAdmin
        .from("support_protocols")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      Object.assign(this, SupportProtocolModel.fromDb(data));
      return this;
    }

    const { data, error } = await supabaseAdmin
      .from("support_protocols")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    Object.assign(this, SupportProtocolModel.fromDb(data));
    return this;
  }

  static async find(query = {}) {
    let q = supabaseAdmin.from("support_protocols").select("*");
    if (query.tenantId) q = q.eq("tenant_id", query.tenantId);
    if (query.phone) q = q.eq("phone", query.phone);
    if (query.status) q = q.eq("status", query.status);
    
    const { data, error } = await q.order("opened_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(row => SupportProtocolModel.fromDb(row));
  }

  static async findById(id) {
    if (!id) return null;
    const { data, error } = await supabaseAdmin
      .from("support_protocols")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    const model = SupportProtocolModel.fromDb(data);
    
    model.save = async function saveSupportProtocol() {
      return model.save();
    };
    return model;
  }
}

module.exports = SupportProtocolModel;
