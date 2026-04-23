const { supabaseAdmin } = require("../config/supabase");

class ContactModel {
  constructor(data = {}) {
    Object.assign(this, data);
  }

  static fromDb(row) {
    if (!row) return null;
    const model = new ContactModel({
      id: row.id,
      _id: row.id,
      agentId: row.agent_id,
      tenantId: row.tenant_id,
      name: row.name,
      phone: row.phone,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });

    model.save = async function saveContact() {
      const payload = {
        agent_id: model.agentId,
        tenant_id: model.tenantId,
        name: model.name,
        phone: model.phone
      };
      const { data: updated, error } = await supabaseAdmin
        .from("contacts")
        .update(payload)
        .eq("id", model.id)
        .select()
        .single();
      
      if (error) throw error;
      Object.assign(model, ContactModel.fromDb(updated));
      return model;
    };

    return model;
  }

  static async insertMany(items) {
    const payloads = items.map(item => ({
      agent_id: item.agentId || item.agent_id,
      tenant_id: item.tenantId || item.tenant_id || item.agentId || item.agent_id,
      name: item.name,
      phone: item.phone
    }));

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .upsert(payloads, { onConflict: 'agent_id, phone' })
      .select();

    if (error) throw error;
    return (data || []).map(row => ContactModel.fromDb(row));
  }

  static async find(query = {}) {
    let q = supabaseAdmin.from("contacts").select("*");
    
    if (query.agentId) q = q.eq("agent_id", query.agentId);
    if (query.tenantId) q = q.eq("tenant_id", query.tenantId);
    if (query.phone) q = q.eq("phone", query.phone);

    const { data, error } = await q.order("name", { ascending: true });
    if (error) throw error;
    return (data || []).map(row => ContactModel.fromDb(row));
  }

  static async findById(id) {
    if (!id) return null;
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("id", id)
      .single();
    
    if (error || !data) return null;
    return ContactModel.fromDb(data);
  }

  static async findByIdAndUpdate(id, update) {
    const payload = {};
    if (update.name !== undefined) payload.name = update.name;
    if (update.phone !== undefined) payload.phone = update.phone;

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    
    if (error) throw error;
    return ContactModel.fromDb(data);
  }

  static async deleteMany(query = {}) {
    let q = supabaseAdmin.from("contacts").delete();
    if (query.agentId) q = q.eq("agent_id", query.agentId);
    if (query.tenantId) q = q.eq("tenant_id", query.tenantId);
    
    const { error } = await q;
    if (error) throw error;
    return true;
  }

  static async deleteById(id) {
    const { error } = await supabaseAdmin
      .from("contacts")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return true;
  }
}

module.exports = ContactModel;
