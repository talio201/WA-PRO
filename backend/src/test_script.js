const LocalDB = require('./config/localDb');

async function test() {
    console.log('Testing LocalDB...');
    const db = new LocalDB('test');
    await db.create({ name: 'Test Object' });
    const items = db.find().data;
    console.log('Items:', items);
}

test();
