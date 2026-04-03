#!/usr/bin/env node

/**
 * Script to inspect SaaS users and admin settings
 * 
 * Usage:
 *   node inspect_saas_data.js [search_email]
 * 
 * Examples:
 *   node inspect_saas_data.js
 *   node inspect_saas_data.js tarciisooguuimaraes@gmail.com
 */

const path = require('path');
const fs = require('fs');

const STORE_PATH = path.join(__dirname, './data/admin-settings.json');
const searchEmail = (process.argv[2] || '').toLowerCase().trim();

console.log('📋 Inspection Script for SaaS Users\n');
console.log(`Store Path: ${STORE_PATH}`);
console.log(`Store Exists: ${fs.existsSync(STORE_PATH) ? 'YES' : 'NO'}`);

if (!fs.existsSync(STORE_PATH)) {
  console.error(`\n❌ Store file not found at ${STORE_PATH}`);
  process.exit(1);
}

try {
  const raw = fs.readFileSync(STORE_PATH, 'utf8');
  const data = JSON.parse(raw);

  console.log('\n═══════════════════════════════════════════');
  console.log(' ADMIN USERS (from local store)');
  console.log('═══════════════════════════════════════════');
  const adminUsers = data.adminUsers || [];
  console.log(`\n📌 Total: ${adminUsers.length}`);
  if (adminUsers.length > 0) {
    console.log('\nList:');
    adminUsers.forEach((email, i) => {
      console.log(`  ${i + 1}. ${email}`);
    });
  } else {
    console.log('(empty)');
  }

  console.log('\n═══════════════════════════════════════════');
  console.log(' SAAS USERS (from local store)');
  console.log('═══════════════════════════════════════════');
  const saasUsers = data.saasUsers || [];
  console.log(`\n📌 Total: ${saasUsers.length}`);

  if (saasUsers.length > 0) {
    console.log('\nAll SaaS Users:');
    saasUsers.forEach((user, i) => {
      console.log(`\n  ${i + 1}. ${user.email}`);
      console.log(`     Status: ${user.status}`);
      console.log(`     Plan: ${user.planTerm || 'none'}`);
      console.log(`     Expires: ${user.expiresAt || 'never'}`);
      if (user.metadata?.access) {
        console.log(`     Permissions: ${JSON.stringify(user.metadata.access)}`);
      }
    });
  } else {
    console.log('(empty - no SaaS users registered yet)');
  }

  if (searchEmail) {
    console.log('\n═══════════════════════════════════════════');
    console.log(` SEARCH: ${searchEmail}`);
    console.log('═══════════════════════════════════════════');

    const inAdmin = adminUsers.includes(searchEmail);
    const inSaas = saasUsers.find(u => (u.email || '').toLowerCase() === searchEmail);

    console.log(`\n✓ In Admin List: ${inAdmin ? 'YES' : 'NO'}`);
    console.log(`✓ In SaaS Users: ${inSaas ? 'YES' : 'NO'}`);

    if (inSaas) {
      console.log('\n📝 Full SaaS User Data:');
      console.log(JSON.stringify(inSaas, null, 2));
    } else {
      console.log('\n❌ User not found in SaaS users');
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════');
  console.log(`\n✅ Store file is valid JSON`);
  console.log(`✅ Admin users: ${adminUsers.length}`);
  console.log(`✅ SaaS users: ${saasUsers.length}`);
  console.log(`✅ Total records: ${adminUsers.length + saasUsers.length}`);

} catch (error) {
  console.error(`\n❌ Error reading store: ${error.message}`);
  process.exit(1);
}
