#!/usr/bin/env node

/**
 * Test script for admin bootstrap endpoint
 * 
 * Usage:
 *   node test_bootstrap.js [supabaseToken] [bootstrapSecret]
 * 
 * Example:
 *   node test_bootstrap.js "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." "my-secret"
 *   node test_bootstrap.js "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."  (no secret)
 */

const http = require('http');
const https = require('https');

const args = process.argv.slice(2);
const supabaseToken = args[0];
const bootstrapSecret = args[1];

const API_URL = process.env.API_URL || 'http://localhost:3000';
const ENDPOINT = '/api/public/admin/bootstrap';

if (!supabaseToken) {
  console.error('❌ Usage: node test_bootstrap.js <supabaseToken> [bootstrapSecret]');
  process.exit(1);
}

console.log('🧪 Testing Bootstrap Endpoint\n');
console.log('Configuration:', {
  API_URL,
  ENDPOINT,
  HAS_TOKEN: !!supabaseToken,
  HAS_SECRET: !!bootstrapSecret,
});

const payload = {
  bootstrapSecret: bootstrapSecret || '',
};

console.log('\n📤 Sending POST request...');
console.log('  Payload:', payload);

const url = new URL(API_URL + ENDPOINT);
const protocol = url.protocol === 'https:' ? https : http;

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${supabaseToken}`,
    'Content-Length': Buffer.byteLength(JSON.stringify(payload)),
  },
};

const req = protocol.request(url, options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('\n✅ Response received:');
    console.log('  Status:', res.statusCode);
    console.log('  Headers:', res.headers);
    
    try {
      const json = JSON.parse(data);
      console.log('  Body:', JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('  Body (raw):', data);
    }

    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('\n✅ Bootstrap endpoint test PASSED');
    } else {
      console.log('\n❌ Bootstrap endpoint test FAILED');
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error('\n❌ Request error:', error.message);
  process.exit(1);
});

req.write(JSON.stringify(payload));
req.end();
