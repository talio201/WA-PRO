const LocalDB = require('../config/localDb');

class MessageModel {
    static insertMany(items) {
        const db = new LocalDB('messages');
        return db.insertMany(items);
    }

    static find(query) {
        const db = new LocalDB('messages');
        return db.find(query);
    }

    static findOneAndUpdate(query, update, options) {
        const db = new LocalDB('messages');
        const operation = db.findOneAndUpdate(query, update, options);

        const buildThenable = (promise) => ({
            then: (onFulfilled, onRejected) => promise.then(onFulfilled, onRejected),
            catch: (onRejected) => promise.catch(onRejected),
        });

        return {
            populate: (field, selectExpression = '') => {
                const populated = Promise.resolve(operation).then(async (doc) => {
                    if (!doc || field !== 'campaign') return doc;

                    const Campaign = require('./Campaign');
                    const campaign = await Campaign.findById(doc.campaign);

                    if (!campaign) {
                        doc.campaign = null;
                        return doc;
                    }

                    const selectedFields = String(selectExpression || '')
                        .split(/\s+/)
                        .map((item) => item.trim())
                        .filter(Boolean);

                    if (selectedFields.length === 0) {
                        doc.campaign = campaign;
                        return doc;
                    }

                    const projection = { _id: campaign._id };
                    selectedFields.forEach((fieldName) => {
                        if (Object.prototype.hasOwnProperty.call(campaign, fieldName)) {
                            projection[fieldName] = campaign[fieldName];
                        }
                    });

                    doc.campaign = projection;
                    return doc;
                });

                return buildThenable(populated);
            },
            then: (onFulfilled, onRejected) => Promise.resolve(operation).then(onFulfilled, onRejected),
            catch: (onRejected) => Promise.resolve(operation).catch(onRejected),
        };
    }

    static findById(id) {
        const db = new LocalDB('messages');
        return db.findById(id).then((doc) => {
            if (!doc) return null;

            doc.save = async function saveMessage() {
                const dbInstance = new LocalDB('messages');
                const payload = { ...doc };
                delete payload.save;
                const updated = await dbInstance.findByIdAndUpdate(doc._id, payload);
                Object.assign(doc, updated || {});
                return doc;
            };

            return doc;
        });
    }

    static deleteMany(query) {
        const db = new LocalDB('messages');
        return db.deleteMany(query);
    }
}

module.exports = MessageModel;
