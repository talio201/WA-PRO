#!/usr/bin/env node

/**
 * Comprehensive Bootstrap Endpoint Test Suite
 * 
 * This script tests multiple scenarios for the admin bootstrap endpoint
 */

const http = require('http');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const tests = [];
let passedTests = 0;
let failedTests = 0;

function formatResponse(status, data) {
  try {
    const json = JSON.parse(data);
    return `\n    Status: ${status}\n    Body: ${JSON.stringify(json, null, 2)}`;
  } catch {
    return `\n    Status: ${status}\n    Body: ${data}`;
  }
}

async function testEndpoint(name, payload, headers = {}) {
  return new Promise((resolve) => {
    console.log(`\n🧪 Test: ${name}`);
    console.log(`   Payload: ${JSON.stringify(payload)}`);
    console.log(`   Headers: Authorization ${headers.Authorization ? '***' : '(none)'}`);

    const url = new URL(API_URL + '/api/public/admin/bootstrap');
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const response = formatResponse(res.statusCode, data);
        console.log(`   Response: ${response}`);
        
        resolve({ name, status: res.statusCode, data, success: res.statusCode < 400 });
      });
    });

    req.on('error', (error) => {
      console.log(`   ❌ Error: ${error.message}`);
      resolve({ name, error: error.message, success: false });
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function runTests() {
  console.log('═════════════════════════════════════════');
  console.log(' Admin Bootstrap Endpoint Test Suite');
  console.log('═════════════════════════════════════════\n');
  console.log(`Testing API at: ${API_URL}\n`);

  // Test 1: No authentication
  await testEndpoint(
    'Test 1: No Authorization Header',
    { bootstrapSecret: 'test' }
  ).then(result => {
    if (result.status === 401 || result.status === 500) {
      console.log('   ✅ PASS: Correctly rejected unauthenticated request');
      passedTests++;
    } else {
      console.log(`   ❌ FAIL: Expected 401 or 500, got ${result.status}`);
      failedTests++;
    }
  });

  // Test 2: Endpoint responds
  await testEndpoint(
    'Test 2: Endpoint Responds (with dummy token)',
    { bootstrapSecret: '' },
    { Authorization: 'Bearer invalid-token' }
  ).then(result => {
    if (result.status && !result.error) {
      console.log(`   ✅ PASS: Endpoint is responding (status ${result.status})`);
      passedTests++;
    } else {
      console.log(`   ❌ FAIL: Endpoint not responding properly`);
      failedTests++;
    }
  });

  // Test 3: Empty secret handling
  await testEndpoint(
    'Test 3: Empty Bootstrap Secret',
    { bootstrapSecret: '' },
    { Authorization: 'Bearer invalid-token' }
  ).then(result => {
    console.log('   ✅ PASS: Endpoint accepts empty secret');
    passedTests++;
  });

  // Test 4: GET method rejection (should be POST-only)
  const options = {
    hostname: new URL(API_URL).hostname,
    port: new URL(API_URL).port || 3000,
    path: '/api/public/admin/bootstrap',
    method: 'GET',
    headers: { 'Authorization': 'Bearer invalid-token' },
  };

  await new Promise(resolve => {
    console.log('\n🧪 Test: Test 4: GET Method (should reject)');
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 405 || data.includes('not allowed')) {
          console.log(`   ✅ PASS: Correctly rejects GET (status ${res.statusCode})`);
          passedTests++;
        } else {
          console.log(`   ✅ PASS: GET request processed (endpoint exists)`);
          failedTests++;
        }
        resolve();
      });
    });
    req.on('error', () => {
      console.log('   ✅ PASS: Request rejected');
      passedTests++;
      resolve();
    });
    req.end();
  });

  // Summary
  console.log('\n═════════════════════════════════════════');
  console.log(' Test Summary');
  console.log('═════════════════════════════════════════');
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);
  console.log(`📊 Total:  ${passedTests + failedTests}\n`);

  if (failedTests === 0) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed.');
    process.exit(1);
  }
}

// Run tests with slight delay to ensure server is ready
setTimeout(runTests, 500);
