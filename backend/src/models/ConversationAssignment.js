const LocalDB = require('../config/localDb');

class ConversationAssignmentModel {
    constructor(data = {}) {
        Object.assign(this, data);
    }

    save() {
        const db = new LocalDB('conversation_assignments');

        if (this._id) {
            const payload = { ...this };
            delete payload.save;
            return db.findByIdAndUpdate(this._id, payload).then((saved) => {
                Object.assign(this, saved || {});
                return this;
            });
        }

        const createPayload = {
            phone: this.phone || '',
            campaignId: this.campaignId || null,
            assignedTo: this.assignedTo || '',
            assignedBy: this.assignedBy || '',
            status: this.status || 'active',
            assignedAt: this.assignedAt || new Date(),
            lastInboundAt: this.lastInboundAt || null,
            closedAt: this.closedAt || null,
            updatedAt: this.updatedAt || new Date(),
            notes: this.notes || '',
        };

        return db.create(createPayload).then((saved) => {
            Object.assign(this, saved || {});
            return this;
        });
    }

    static find(query = {}) {
        const db = new LocalDB('conversation_assignments');
        return db.find(query);
    }

    static findById(id) {
        const db = new LocalDB('conversation_assignments');
        return db.findById(id).then((doc) => {
            if (!doc) return null;

            doc.save = async function saveConversationAssignment() {
                const dbInstance = new LocalDB('conversation_assignments');
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

module.exports = ConversationAssignmentModel;
