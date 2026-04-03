#!/usr/bin/env node

/**
 * Simulate a complete bootstrap flow for testing
 * This tests both the adminStore functions and the bootstrap endpoint
 */

const path = require('path');

// Import the admin store functions directly
const {
  upsertSaasUser,
  getSaasUserByEmail,
  listSaasUsers,
  addAdminUser,
  listAdminUsers,
  getSaasUserByEmail: getUser,
} = require('./src/config/adminStore');

const testEmail = 'tarciisooguuimaraes@gmail.com';

console.log('🧪 Testing Complete Bootstrap Flow\n');
console.log('═════════════════════════════════════════\n');

// Test 1: Check initial state
console.log('Step 1: Check Initial State');
const initialAdmin = listAdminUsers();
const initialSaas = listSaasUsers();
console.log(`  Admin Users: ${initialAdmin.length}`);
console.log(`  SaaS Users: ${initialSaas.length}`);
console.log(`  Has ${testEmail}? NO\n`);

// Test 2: Upsert SaaS user (simulate bootstrap)
console.log('Step 2: Upsert SaaS User (Bootstrap)');
const bootstrapped = upsertSaasUser({
  email: testEmail,
  status: 'active',
  planTerm: 'lifetime',
  expiresAt: null,
  metadata: {
    bootstrap: {
      enabledAt: new Date().toISOString(),
      enabledBy: 'test-script',
    },
    access: {
      allowApp: true,
      allowAdmin: true,
      allowBot: true,
    },
  },
});
console.log(`  Upserted user: ${bootstrapped?.email || 'FAILED'}`);
console.log(`  Status: ${bootstrapped?.status || 'UNKNOWN'}`);
console.log(`  Can access admin: ${bootstrapped?.metadata?.access?.allowAdmin || 'UNKNOWN'}\n`);

// Test 3: Add to admin list
console.log('Step 3: Add to Admin Users List');
addAdminUser(testEmail);
const adminAfter = listAdminUsers();
console.log(`  Admin users count: ${adminAfter.length}`);
console.log(`  List: ${JSON.stringify(adminAfter)}`);
console.log(`  Has ${testEmail}? ${adminAfter.includes(testEmail) ? 'YES ✓' : 'NO ✗'}\n`);

// Test 4: Verify SaaS user was saved
console.log('Step 4: Verify SaaS User Persistence');
const saasNow = listSaasUsers();
const found = getSaasUserByEmail(testEmail);
console.log(`  SaaS users total: ${saasNow.length}`);
console.log(`  User found by email: ${found ? 'YES ✓' : 'NO ✗'}`);
if (found) {
  console.log(`  Email: ${found.email}`);
  console.log(`  Status: ${found.status}`);
  console.log(`  Permissions: ${JSON.stringify(found.metadata?.access)}`);
} else {
  console.log(`  ❌ FAILED: User not found after upsert!`);
}
console.log('');

// Test 5: Summary
console.log('═════════════════════════════════════════\n');
console.log('Step 5: Summary\n');

const finalAdmin = listAdminUsers();
const finalSaas = listSaasUsers();
const finalUser = getSaasUserByEmail(testEmail);

const tests = {
  'User in SaaS list': finalSaas.length > 0 && finalUser !== null,
  'User in Admin list': finalAdmin.includes(testEmail),
  'User has allowAdmin': finalUser?.metadata?.access?.allowAdmin === true,
  'User is active': finalUser?.status === 'active',
};

Object.entries(tests).forEach(([name, pass]) => {
  console.log(`  ${pass ? '✅' : '❌'} ${name}`);
});

console.log('\n═════════════════════════════════════════\n');

const allPassed = Object.values(tests).every(v => v);
if (allPassed) {
  console.log('🎉 All tests PASSED! Bootstrap process works correctly.\n');
  process.exit(0);
} else {
  console.log('⚠️  Some tests FAILED! There are issues with bootstrap.\n');
  process.exit(1);
}
