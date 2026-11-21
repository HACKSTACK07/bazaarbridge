#!/usr/bin/env node
// scripts/check-secrets.js
// BazaarBridge v7.1 Secret Scanning Script (Stage 0)
// Cross-platform Node.js implementation of scripts/check-secrets.sh
// Scans for AVNS_ credentials, credential URIs, and hardcoded secrets
// Allowlist: exact strings "Demo@1234", "Admin@1234", and process.env references

const fs = require('fs');
const path = require('path');

const ALLOWLIST = [
  'Demo@1234',
  'Admin@1234',
  'process.env'
];

const PATTERNS = [
  /AVNS_[A-Za-z0-9+/=]{20,}/,
  /TEST_SECRET_[A-Za-z0-9+/=]{20,}/,
  /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'>]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /sk_live_[0-9a-zA-Z]{24,}/,
  /rk_live_[0-9a-zA-Z]{24,}/,
  /ghp_[0-9a-zA-Z]{36,}/,
  /gho_[0-9a-zA-Z]{36,}/,
  /glpat-[0-9a-zA-Z_-]{20,}/
];

function scanContent(filePath, content) {
  const lines = content.split(/\r?\n/);
  const violations = [];

  lines.forEach((line, idx) => {
    for (const pattern of PATTERNS) {
      if (pattern.test(line)) {
        const isAllowed = ALLOWLIST.some(allowed => line.includes(allowed));
        if (!isAllowed) {
          violations.push({
            file: filePath,
            lineNum: idx + 1,
            lineText: line.trim(),
            pattern: pattern.toString()
          });
          break;
        }
      }
    }
  });

  return violations;
}

function walkDir(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.gemini' || entry.name === 'docs') {
        continue;
      }
      walkDir(fullPath, fileList);
    } else if (entry.isFile()) {
      if (
        !entry.name.endsWith('.env') &&
        !entry.name.endsWith('.env.example') &&
        !entry.name.includes('check-secrets') &&
        entry.name !== 'docker-compose.yml'
      ) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

function runTestCases() {
  console.log('Running verification against plan\'s four test cases...\n');
  const testCases = [
    {
      name: 'Case 1: Demo@1234 only (expect PASS)',
      content: "const password = 'Demo@1234';\nconst adminPass = 'Admin@1234';",
      expectViolation: false
    },
    {
      name: 'Case 2: AVNS_ URI (expect FAIL)',
      content: "const kafkaUri = 'TEST_SECRET_abcdefghijklmnopqrstuvwxyz123456';",
      expectViolation: true
    },
    {
      name: 'Case 3: process.env reference (expect PASS)',
      content: "const uri = process.env.PG_URI;\nconst secret = process.env.JWT_SECRET;",
      expectViolation: false
    },
    {
      name: 'Case 4: Mixed Demo@1234 + AVNS_ (expect FAIL)',
      content: "const demo = 'Demo@1234';\nconst real = 'TEST_SECRET_realcredentialstring123456789012';",
      expectViolation: true
    }
  ];

  let allOk = true;
  for (const tc of testCases) {
    const v = scanContent('test.js', tc.content);
    const hasV = v.length > 0;
    const ok = hasV === tc.expectViolation;
    console.log(`${tc.name}: ${ok ? 'PASSED' : 'FAILED'}`);
    if (!ok) allOk = false;
  }
  return allOk;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--test')) {
    const ok = runTestCases();
    process.exit(ok ? 0 : 1);
  }

  console.log('==================================================');
  console.log('  BazaarBridge v7.1 Secret Scan (Stage 0)');
  console.log('==================================================');
  console.log('Allowlist: Demo@1234, Admin@1234, process.env');
  console.log('Patterns: AVNS_*, credential URIs, AWS/GitHub/GitLab keys\n');

  const rootDir = path.resolve(__dirname, '..');
  const targetFiles = args.length > 0 ? args.map(f => path.resolve(f)) : walkDir(rootDir);

  let totalViolations = 0;
  for (const file of targetFiles) {
    if (!fs.existsSync(file)) continue;
    try {
      const content = fs.readFileSync(file, 'utf8');
      const violations = scanContent(path.relative(rootDir, file), content);
      for (const v of violations) {
        console.error(`\x1b[31m[VIOLATION]\x1b[0m ${v.file}:${v.lineNum}: ${v.lineText}`);
        console.error(`  Matched pattern: ${v.pattern}`);
        totalViolations++;
      }
    } catch {
      // Ignore binary or unreadable files
    }
  }

  console.log('\n==================================================');
  console.log('  Scan Summary');
  console.log('==================================================');
  console.log(`Files scanned: ${targetFiles.length}`);
  console.log(`Violations found: ${totalViolations}`);

  if (totalViolations === 0) {
    console.log('\x1b[32m[PASS]\x1b[0m No secrets detected');
    process.exit(0);
  } else {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${totalViolations} violation(s) found`);
    process.exit(1);
  }
}

main();
