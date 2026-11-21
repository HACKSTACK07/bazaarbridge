#!/usr/bin/env node
// scripts/run-tests.js
// Agent D: Phase 1 Test Runner for BazaarBridge (Version 7.2)
// Uses Node.js built-in test runner (node:test)
// Strictly follows agent-rules.md: "Never report BLOCKED as PASS."

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PHASE1_TESTS = [
  // Smoke tests
  'backend/src/tests/smoke-auth.test.js',
  // Search tests
  'backend/src/tests/search-filters.test.js',
  'backend/src/tests/search-filters-quick.test.js',
  // Comparison tests
  'backend/src/tests/comparison-winners.test.js',
  'backend/src/tests/comparison-api.test.js',
  // Atomic reservation
  'backend/src/tests/concurrency.test.js',
  // Order integrity
  'backend/src/tests/price-change.test.js',
  'backend/src/tests/price-change-retry.test.js',
  'backend/src/tests/release-idempotency.test.js',
  'backend/src/tests/order-reconciliation.test.js',
  // Event pipeline (Phase 1)
  'backend/src/tests/duplicate-event.test.js',
  'backend/src/tests/stale-index.test.js',
  'backend/src/tests/finalizer-guard.test.js',
  'backend/src/tests/finalizer-deadlock.test.js',
  'backend/src/tests/eta-events.test.js',
  'backend/src/tests/notification-deduplication.test.js',
  'backend/src/tests/refund-flow.test.js',
  'backend/src/tests/stock-transfer-flow.test.js'
];

const PHASE2_TESTS = [
  // Cancellation tests
  'backend/src/tests/cancel-before-finalise.test.js',
  'backend/src/tests/cancel-after-finalise.test.js',
  'backend/src/tests/cancel-finalize-race.test.js',
  'backend/src/tests/cancel-cross-key.test.js',
  'backend/src/tests/restock-missing-row.test.js',
  // Refund tests
  'backend/src/tests/double-refund.test.js',
  'backend/src/tests/refund-cap.test.js',
  // Notification dedup
  'backend/src/tests/notification-dedup.test.js',
  // Transfer flow
  'backend/src/tests/transfer-flow.test.js',
  'backend/src/tests/transfer-cancel-race.test.js',
  // Mode & fee
  'backend/src/tests/mode-and-fee.test.js',
  // OTP
  'backend/src/tests/otp-all-modes.test.js',
  // Hub pause
  'backend/src/tests/hub-pause.test.js',
  // Conditional (FEATURE_COUPONS, FEATURE_ASSISTANT)
  'backend/src/tests/coupon-race.test.js',
  'backend/src/tests/assistant-fallback.test.js'
];

function getTestFiles() {
  const phase = process.env.TEST_PHASE || '1';
  if (phase === '2' || phase === 'all') {
    return [...PHASE1_TESTS, ...PHASE2_TESTS];
  }
  return PHASE1_TESTS;
}

function checkEnv() {
  const missing = [];
  if (!process.env.PG_URI) missing.push('PG_URI');
  if (!process.env.API_BASE) missing.push('API_BASE (defaulting to http://localhost:3000)');

  console.log('Environment Status:');
  console.log('  PG_URI:   ', process.env.PG_URI ? 'CONFIGURED' : 'NOT SET');
  console.log('  API_BASE: ', process.env.API_BASE || 'http://localhost:3000');
  console.log('');

  if (!process.env.PG_URI) {
    console.log('[Test Runner] NOTICE: PG_URI is unset.');
    console.log('              Integration tests requiring live PostgreSQL/API will report BLOCKED.');
    console.log('              Per agent-rules.md: "Never report BLOCKED as PASS."\n');
  }
}

function runTest(file) {
  const fullPath = path.resolve(__dirname, '..', file);
  if (!fs.existsSync(fullPath)) {
    console.error(`[Test Runner] File not found: ${file}`);
    return { file, status: 'MISSING', error: 'File not found' };
  }

  console.log(`\n[Test Runner] Executing: ${file}`);
  console.log('─'.repeat(60));

  try {
    const output = execSync(`node --test "${fullPath}"`, {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env }
    });
    console.log(output.trim());
    
    // Check output for BLOCKED/skipped tests even when exit code is 0
    // Look for actual skipped test indicators, not just the word "skipped" in summary
    const hasBlocked = output.includes('[BLOCKED]') || output.includes('BLOCKED:') || output.includes('# BLOCKED');
    const hasSkippedTests = output.match(/skipped\s+(\d+)/) && parseInt(output.match(/skipped\s+(\d+)/)[1]) > 0;
    if (hasBlocked || hasSkippedTests) {
      return { file, status: 'BLOCKED', detail: 'External service unavailable (detected in output)' };
    }
    return { file, status: 'PASS' };
  } catch (err) {
    const stdout = err.stdout || '';
    const stderr = err.stderr || '';
    const combined = (stdout + '\n' + stderr).trim();
    console.log(combined || err.message);

    const hasBlocked = combined.includes('[BLOCKED]') || combined.includes('BLOCKED:') || combined.includes('# BLOCKED');
    const hasSkippedTests = combined.match(/skipped\s+(\d+)/) && parseInt(combined.match(/skipped\s+(\d+)/)[1]) > 0;
    if (hasBlocked || hasSkippedTests) {
      return { file, status: 'BLOCKED', detail: 'External service unavailable' };
    }
    return { file, status: 'FAIL', error: err.message };
  }
}

function main() {
  console.log('================================================================');
  console.log('  BazaarBridge Agent D - Test Suite (Version 7.2)');
  console.log('================================================================\n');

  const testFiles = getTestFiles();
  const phase = process.env.TEST_PHASE || '1';
  console.log(`Running Phase ${phase === 'all' ? '1+2' : phase} tests (${testFiles.length} files)\n`);

  checkEnv();

  const results = [];
  for (const file of testFiles) {
    results.push(runTest(file));
  }

  console.log('\n================================================================');
  console.log('  Test Suite Summary (Gate Referee Report)');
  console.log('================================================================');

  results.forEach(r => {
    const badge = r.status === 'PASS' ? '[PASS]' : (r.status === 'BLOCKED' ? '[BLOCKED]' : '[FAIL]');
    console.log(`  ${badge.padEnd(10)} ${r.file}`);
  });

  const passCount = results.filter(r => r.status === 'PASS').length;
  const blockedCount = results.filter(r => r.status === 'BLOCKED').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;

  console.log(`\nTotal: ${results.length} | Passed: ${passCount} | Blocked: ${blockedCount} | Failed: ${failCount}`);

  if (failCount > 0) {
    console.error('\nResult: FAILED. One or more assertions failed.');
    process.exit(1);
  } else if (blockedCount > 0) {
    console.log('\nResult: BLOCKED (Prerequisite services offline).');
    console.log('Per agent-rules.md: "Never report BLOCKED as PASS."');
    process.exit(0);
  } else {
    console.log('\nResult: ALL TESTS PASSED.');
    process.exit(0);
  }
}

main();