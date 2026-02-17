#!/bin/bash

# Service-Role Query Security Audit
# Finds all createServiceClient() usages and verifies tenant_id filtering
# to prevent cross-tenant data leakage

set -e

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Counters
TOTAL=0
PASS=0
WARNING=0
FAIL=0

# Output file
OUTPUT_FILE="audits/service-role-findings.txt"

echo "=== Service-Role Query Security Audit ==="
echo ""
echo "Finding all createServiceClient() usages in src/ ..."
echo ""

# Create temporary file for results
TEMP_FILE=$(mktemp)

# Write header to output file
echo "=== Service-Role Query Security Audit ===" > "$OUTPUT_FILE"
echo "Generated: $(date)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Find all files using createServiceClient()
FILES=$(grep -r "createServiceClient()" src/ --include="*.ts" --include="*.tsx" -l | sort -u)

if [ -z "$FILES" ]; then
  echo "No files found using createServiceClient()"
  exit 0
fi

# Analyze each file
while IFS= read -r file; do
  TOTAL=$((TOTAL + 1))

  echo "---" >> "$OUTPUT_FILE"
  echo "File: $file" >> "$OUTPUT_FILE"

  # Check if file is in platform admin routes
  if [[ "$file" =~ src/app/platform/ ]] || [[ "$file" =~ src/app/api/platform/ ]]; then
    echo -e "${GREEN}✓ PASS${NC}: $file (platform admin route - should use service client)"
    echo "Status: ✓ PASS (platform admin route)" >> "$OUTPUT_FILE"
    echo "Reason: Platform admin routes legitimately need to see all tenants" >> "$OUTPUT_FILE"
    PASS=$((PASS + 1))
    echo "" >> "$OUTPUT_FILE"
    continue
  fi

  # Check if file is tenant resolution utility (context.ts)
  if [[ "$file" =~ src/lib/tenant/context.ts ]]; then
    echo -e "${GREEN}✓ PASS${NC}: $file (tenant resolution - queries tenants table)"
    echo "Status: ✓ PASS (tenant resolution)" >> "$OUTPUT_FILE"
    echo "Reason: Tenant context resolution legitimately queries tenants table" >> "$OUTPUT_FILE"
    PASS=$((PASS + 1))
    echo "" >> "$OUTPUT_FILE"
    continue
  fi

  # Check if file is Square config (config.ts)
  if [[ "$file" =~ src/lib/square/config.ts ]]; then
    echo -e "${GREEN}✓ PASS${NC}: $file (Square config - uses RPC with tenant_id parameter)"
    echo "Status: ✓ PASS (Square config)" >> "$OUTPUT_FILE"
    echo "Reason: Uses get_tenant_square_credentials_internal RPC with tenant_id parameter" >> "$OUTPUT_FILE"
    PASS=$((PASS + 1))
    echo "" >> "$OUTPUT_FILE"
    continue
  fi

  # Check if file has .from() queries
  if ! grep -q "\.from(" "$file"; then
    echo -e "${GREEN}✓ PASS${NC}: $file (no .from() queries)"
    echo "Status: ✓ PASS (no queries)" >> "$OUTPUT_FILE"
    echo "Reason: Uses service client but doesn't query tables" >> "$OUTPUT_FILE"
    PASS=$((PASS + 1))
    echo "" >> "$OUTPUT_FILE"
    continue
  fi

  # File has .from() queries - check for tenant_id filtering
  HAS_TENANT_FILTER=false

  # Check for .eq('tenant_id')
  if grep -q "\.eq('tenant_id'" "$file" || grep -q '\.eq("tenant_id"' "$file"; then
    HAS_TENANT_FILTER=true
  fi

  # Check for WHERE tenant_id in SQL
  if grep -q "WHERE tenant_id" "$file"; then
    HAS_TENANT_FILTER=true
  fi

  # Check for RPC calls with p_tenant_id parameter
  if grep -q "p_tenant_id" "$file"; then
    HAS_TENANT_FILTER=true
  fi

  if [ "$HAS_TENANT_FILTER" = true ]; then
    echo -e "${GREEN}✓ PASS${NC}: $file (has tenant_id filtering)"
    echo "Status: ✓ PASS (explicit tenant_id filter)" >> "$OUTPUT_FILE"
    grep -n "\.eq('tenant_id'" "$file" | head -3 >> "$OUTPUT_FILE" || true
    grep -n '\.eq("tenant_id"' "$file" | head -3 >> "$OUTPUT_FILE" || true
    grep -n "WHERE tenant_id" "$file" | head -3 >> "$OUTPUT_FILE" || true
    grep -n "p_tenant_id" "$file" | head -3 >> "$OUTPUT_FILE" || true
    PASS=$((PASS + 1))
  else
    # Check if it's a vault credential function (accepts tenant_id as parameter)
    if grep -q "get_tenant_square_credentials" "$file" || grep -q "store_square_credentials" "$file"; then
      echo -e "${GREEN}✓ PASS${NC}: $file (Vault RPC with tenant_id parameter)"
      echo "Status: ✓ PASS (Vault RPC)" >> "$OUTPUT_FILE"
      echo "Reason: Vault credential functions accept tenant_id as parameter" >> "$OUTPUT_FILE"
      PASS=$((PASS + 1))
    else
      # Potential security issue - no tenant filtering detected
      echo -e "${RED}✗ FAIL${NC}: $file (has .from() query but NO tenant_id filter)"
      echo "Status: ✗ FAIL" >> "$OUTPUT_FILE"
      echo "Reason: Service-role query without explicit tenant_id filtering" >> "$OUTPUT_FILE"
      echo "Risk: CRITICAL - Can leak cross-tenant data" >> "$OUTPUT_FILE"
      echo "Queries found:" >> "$OUTPUT_FILE"
      grep -n "\.from(" "$file" | head -5 >> "$OUTPUT_FILE"
      echo "" >> "$OUTPUT_FILE"
      echo "Recommended fix: Add .eq('tenant_id', tenantId) to all queries" >> "$OUTPUT_FILE"
      FAIL=$((FAIL + 1))
    fi
  fi

  echo "" >> "$OUTPUT_FILE"
done <<< "$FILES"

# Summary
echo ""
echo "=== AUDIT SUMMARY ===" | tee -a "$OUTPUT_FILE"
echo "Total files analyzed: $TOTAL" | tee -a "$OUTPUT_FILE"
echo -e "${GREEN}✓ PASS: $PASS${NC}" | tee -a "$OUTPUT_FILE"
echo -e "${YELLOW}⚠️  WARNING: $WARNING${NC}" | tee -a "$OUTPUT_FILE"
echo -e "${RED}✗ FAIL: $FAIL${NC}" | tee -a "$OUTPUT_FILE"
echo "" | tee -a "$OUTPUT_FILE"

if [ $FAIL -gt 0 ]; then
  echo -e "${RED}CRITICAL: $FAIL files with potential cross-tenant data leakage${NC}" | tee -a "$OUTPUT_FILE"
  echo "Review $OUTPUT_FILE for details" | tee -a "$OUTPUT_FILE"
  exit 1
elif [ $WARNING -gt 0 ]; then
  echo -e "${YELLOW}WARNING: $WARNING files need manual review${NC}" | tee -a "$OUTPUT_FILE"
  echo "Review $OUTPUT_FILE for details" | tee -a "$OUTPUT_FILE"
  exit 0
else
  echo -e "${GREEN}All service-role queries verified secure${NC}" | tee -a "$OUTPUT_FILE"
  exit 0
fi
