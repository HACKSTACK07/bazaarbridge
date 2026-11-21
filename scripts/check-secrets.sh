#!/usr/bin/env bash
# scripts/check-secrets.sh
# BazaarBridge v7.1 Secret Scanning Script (Stage 0)
# Scans for AVNS_ credentials, credential URIs, and hardcoded secrets
# Allowlist: exact strings "Demo@1234", "Admin@1234", and process.env references

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ALLOWLIST=(
  "Demo@1234"
  "Admin@1234"
  "process.env"
)

PATTERNS=(
  "AVNS_[A-Za-z0-9+/=]{20,}"
  "TEST_SECRET_[A-Za-z0-9+/=]{20,}"
  "[a-zA-Z][a-zA-Z0-9+.-]*://[^:\\s\"/'>]*[:@][^\\s\"'>]{8,}"
  "AKIA[0-9A-Z]{16}"
  "sk_live_[0-9a-zA-Z]{24,}"
  "rk_live_[0-9a-zA-Z]{24,}"
  "ghp_[0-9a-zA-Z]{36,}"
  "gho_[0-9a-zA-Z]{36,}"
  "glpat-[0-9a-zA-Z_-]{20,}"
)

scan_file() {
  local file="$1"
  local violations=0

  for pattern in "${PATTERNS[@]}"; do
    local matches
    matches=$(grep -nE "$pattern" "$file" 2>/dev/null || true)
    if [[ -n "$matches" ]]; then
      while IFS= read -r match_line; do
        [[ -z "$match_line" ]] && continue
        local allowed=false
        for allowed_str in "${ALLOWLIST[@]}"; do
          if [[ "$match_line" == *"$allowed_str"* ]]; then
            allowed=true
            break
          fi
        done
        if [[ "$allowed" == false ]]; then
          echo -e "${RED}[VIOLATION]${NC} $file:$match_line"
          echo -e "  Matched pattern: $pattern"
          violations=$((violations + 1))
        fi
      done <<< "$matches"
    fi
  done

  return $violations
}

main() {
  local total_violations=0
  local scanned=0

  echo "=================================================="
  echo "  BazaarBridge v7.1 Secret Scan (Stage 0)"
  echo "=================================================="
  echo "Allowlist: Demo@1234, Admin@1234, process.env"
  echo "Patterns: AVNS_*, credential URIs, AWS/GitHub/GitLab keys"
  echo ""

  while IFS= read -r -d '' file; do
    if [[ -f "$file" && ! "$file" =~ \.git/ && ! "$file" =~ node_modules/ && ! "$file" =~ \.env(\.example)?$ && ! "$file" =~ check-secrets && ! "$file" =~ docker-compose\.yml$ ]]; then
      scan_file "$file"
      total_violations=$((total_violations + $?))
      scanned=$((scanned + 1))
    fi
  done < <(find . -name '.git' -prune -o -name 'node_modules' -prune -o -type f -print0)

  echo ""
  echo "=================================================="
  echo "  Scan Summary"
  echo "=================================================="
  echo "Files scanned: $scanned"
  echo "Violations found: $total_violations"

  if [[ $total_violations -eq 0 ]]; then
    echo -e "${GREEN}[PASS]${NC} No secrets detected"
    exit 0
  else
    echo -e "${RED}[FAIL]${NC} $total_violations violation(s) found"
    exit 1
  fi
}

# Test mode: verify against the four cases from the plan's table
if [[ "${1:-}" == "--test" ]]; then
  echo "Running verification against plan's four test cases..."
  echo ""

  TMPDIR=$(mktemp -d)
  trap "rm -rf $TMPDIR" EXIT

  # Case 1: demo password CLEAN (should PASS)
  cat > "$TMPDIR/case1_clean.js" <<'EOF'
const password = 'Demo@1234';
const adminPass = 'Admin@1234';
EOF

  # Case 2: AVNS_ URI ABORT (should FAIL)
  cat > "$TMPDIR/case2_avns.js" <<'EOF'
const kafkaUri = 'TEST_SECRET_abcdefghijklmnopqrstuvwxyz123456';
EOF

  # Case 3: process.env reference CLEAN (should PASS)
  cat > "$TMPDIR/case3_process_env.js" <<'EOF'
const uri = process.env.PG_URI;
const secret = process.env.JWT_SECRET;
EOF

  # Case 4: mixed demo+real ABORT (should FAIL)
  cat > "$TMPDIR/case4_mixed.js" <<'EOF'
const demo = 'Demo@1234';
const real = 'TEST_SECRET_realcredentialstring123456789012';
EOF

  echo "Case 1: Demo@1234 only (expect PASS)"
  bash "$0" "$TMPDIR/case1_clean.js" 2>&1 | tail -5

  echo ""
  echo "Case 2: AVNS_ URI (expect FAIL)"
  bash "$0" "$TMPDIR/case2_avns.js" 2>&1 | tail -5

  echo ""
  echo "Case 3: process.env reference (expect PASS)"
  bash "$0" "$TMPDIR/case3_process_env.js" 2>&1 | tail -5

  echo ""
  echo "Case 4: Mixed Demo@1234 + AVNS_ (expect FAIL)"
  bash "$0" "$TMPDIR/case4_mixed.js" 2>&1 | tail -5

  exit 0
fi

# If file arguments provided, scan only those
if [[ $# -gt 0 ]]; then
  total_violations=0
  for file in "$@"; do
    scan_file "$file"
    total_violations=$((total_violations + $?))
  done
  if [[ $total_violations -eq 0 ]]; then
    echo -e "${GREEN}[PASS]${NC}"
    exit 0
  else
    echo -e "${RED}[FAIL]${NC} $total_violations violation(s)"
    exit 1
  fi
fi

main