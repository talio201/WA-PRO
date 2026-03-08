const LocalDB = require('../config/localDb');

// Use a class that mimics the Mongoose Model interface
class CampaignModel {
    constructor(data = {}) {
        Object.assign(this, data);
    }

    save() {
        const db = new LocalDB('campaigns');
        // Ensure stats structure
        if (!this.stats) {
            this.stats = { total: 0, sent: 0, failed: 0 };
        }
        // Ensure media structure
        if (!this.media) {
            this.media = null; // { url: string, type: 'image'|'video'|'audio', fileName: string }
        }
        // Ensure anti-ban delay settings
        if (!this.antiBan) {
            this.antiBan = { minDelaySeconds: 0, maxDelaySeconds: 120 };
        }
        return db.create(this).then(saved => {
            Object.assign(this, saved); // Update instance with _id
            return saved;
        });
    }

    static find(query) {
        const db = new LocalDB('campaigns');
        return db.find(query);
    }

    static findById(id) {
        const db = new LocalDB('campaigns');
        return db.findById(id).then((doc) => {
            if (!doc) return null;

            doc.save = async function saveCampaign() {
                const dbInstance = new LocalDB('campaigns');
                const payload = { ...doc };
                delete payload.save;
                const updated = await dbInstance.findByIdAndUpdate(doc._id, payload);
                Object.assign(doc, updated || {});
                return doc;
            };

            return doc;
        });
    }

    static findByIdAndUpdate(id, update) {
        const db = new LocalDB('campaigns');
        return db.findByIdAndUpdate(id, update);
    }

    static deleteMany(query) {
        const db = new LocalDB('campaigns');
        return db.deleteMany(query);
    }

    static deleteById(id) {
        const db = new LocalDB('campaigns');
        return db.deleteById(id);
    }
}

module.exports = CampaignModel;
