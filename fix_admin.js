const fs = require('fs');

const file = '/opt/EmidiaWhats/backend/data/admin-settings.json';
const emailsToAdd = process.argv.slice(2);

if (emailsToAdd.length === 0) {
    console.log('Usage: node fix_admin.js <email1> <email2> ...');
    process.exit(1);
}

try {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    const admins = new Set(data.adminUsers || []);
    
    emailsToAdd.forEach(email => {
        if (email) {
            admins.add(email.trim());
        }
    });

    data.adminUsers = Array.from(admins);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log('Admins updated: ' + data.adminUsers.join(', '));
} catch (error) {
    console.error('Failed to update admin settings:', error.message);
    // If the file doesn't exist, create it with the new admins
    if (error.code === 'ENOENT') {
        const data = { adminUsers: emailsToAdd.filter(Boolean).map(e => e.trim()) };
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        console.log('Created admin-settings.json with admins: ' + data.adminUsers.join(', '));
    }
}

