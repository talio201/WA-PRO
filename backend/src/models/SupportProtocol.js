const LocalDB = require("../config/localDb");

class SupportProtocolModel {
  constructor(data = {}) {
    Object.assign(this, data);
  }

  save() {
    const db = new LocalDB("support_protocols");
    if (this._id) {
      const payload = { ...this };
      delete payload.save;
      return db.findByIdAndUpdate(this._id, payload).then((saved) => {
        Object.assign(this, saved || {});
        return this;
      });
    }
    const createPayload = {
      phone: this.phone || "",
      campaignId: this.campaignId || null,
      protocolNumber: this.protocolNumber || "",
      customerName: this.customerName || "",
      subject: this.subject || "",
      description: this.description || "",
      priority: this.priority || "normal",
      status: this.status || "open",
      assignedTo: this.assignedTo || "",
      openedBy: this.openedBy || "",
      openedAt: this.openedAt || new Date(),
      closedAt: this.closedAt || null,
      updatedAt: this.updatedAt || new Date(),
      metadata: this.metadata || {},
    };
    return db.create(createPayload).then((saved) => {
      Object.assign(this, saved || {});
      return this;
    });
  }

  static find(query = {}) {
    const db = new LocalDB("support_protocols");
    return db.find(query);
  }

  static findById(id) {
    const db = new LocalDB("support_protocols");
    return db.findById(id).then((doc) => {
      if (!doc) return null;
      doc.save = async function saveSupportProtocol() {
        const dbInstance = new LocalDB("support_protocols");
        const payload = { ...doc };
        delete payload.save;
        const updated = await dbInstance.findByIdAndUpdate(doc._id, payload);
        Object.assign(doc, updated || {});
        return doc;
      };
      return doc;
    });
  }
}

module.exports = SupportProtocolModel;