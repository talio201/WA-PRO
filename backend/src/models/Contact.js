const LocalDB = require("../config/localDb");

class ContactModel {
  static insertMany(items) {
    const db = new LocalDB("contacts");
    return db.insertMany(items);
  }

  static find(query) {
    const db = new LocalDB("contacts");
    return db.find(query);
  }

  static findById(id) {
    const db = new LocalDB("contacts");
    return db.findById(id).then((doc) => {
      if (!doc) return null;
      doc.save = async function saveContact() {
        const dbInstance = new LocalDB("contacts");
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
    const db = new LocalDB("contacts");
    return db.findByIdAndUpdate(id, update);
  }

  static deleteMany(query) {
    const db = new LocalDB("contacts");
    return db.deleteMany(query);
  }

  static deleteById(id) {
    const db = new LocalDB("contacts");
    return db.deleteById(id);
  }
}

module.exports = ContactModel;
