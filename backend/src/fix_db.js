const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/db.json');

try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

    let fixedCount = 0;
    data.campaigns = data.campaigns.map(c => {
        if (!c.status) {
            c.status = 'running'; // Force running for old campaigns
            fixedCount++;
        }
        return c;
    });

    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    console.log(`Fixed ${fixedCount} campaigns. please restart backend.`);
} catch (e) {
    console.error(e);
}
