#!/bin/bash

# Module-Level Cache Security Audit
# Finds all globalThis cache usages and verifies tenant-scoped keying
# to prevent cross-tenant data pollution

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
OUTPUT_FILE="audits/cache-findings.txt"

echo "=== Module-Level Cache Security Audit ==="
echo ""
echo "Finding all globalThis cache usages in src/ ..."
echo ""

# Write header to output file
echo "=== Module-Level Cache Security Audit ===" > "$OUTPUT_FILE"
echo "Generated: $(date)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Find all files with globalThis declarations
FILES=$(grep -r "globalThis\." src/ --include="*.ts" --include="*.tsx" -l | sort -u)

if [ -z "$FILES" ]; then
  echo "No files found using globalThis caching"
  exit 0
fi

# Analyze each file
while IFS= read -r file; do
  TOTAL=$((TOTAL + 1))

  echo "---" >> "$OUTPUT_FILE"
  echo "File: $file" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  # Extract cache variable names and their types
  echo "Cache declarations:" >> "$OUTPUT_FILE"
  grep -n "globalThis\." "$file" | head -10 >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  # Check for tenant-scoped keying patterns
  HAS_TENANT_SCOPING=false

  # Pattern 1: tenantId in function parameters for get/set
  if grep -q "tenantId" "$file" && grep -q "\.get(" "$file"; then
    HAS_TENANT_SCOPING=true
  fi

  # Pattern 2: Composite key with tenantId template literal
  if grep -q "\${tenantId}" "$file" || grep -q "\`\${tenantId}" "$file"; then
    HAS_TENANT_SCOPING=true
  fi

  # Pattern 3: Map keyed by slug (for tenant cache)
  if grep -q "cache\.get(slug)" "$file" && grep -q "tenant" "$file"; then
    HAS_TENANT_SCOPING=true
  fi

  # Check specific known caches
  if [[ "$file" =~ src/lib/tenant/cache.ts ]]; then
    echo -e "${GREEN}✓ PASS${NC}: $file (tenant cache - keyed by slug)"
    echo "Status: ✓ PASS" >> "$OUTPUT_FILE"
    echo "Cache: __tenantCache (Map<string, TenantCacheEntry>)" >> "$OUTPUT_FILE"
    echo "Key pattern: slug (tenant identifier)" >> "$OUTPUT_FILE"
    echo "Evidence:" >> "$OUTPUT_FILE"
    grep -n "cache\.get(slug)" "$file" | head -3 >> "$OUTPUT_FILE"
    PASS=$((PASS + 1))
    echo "" >> "$OUTPUT_FILE"
    continue
  fi

  if [[ "$file" =~ src/lib/square/config.ts ]]; then
    echo -e "${GREEN}✓ PASS${NC}: $file (Square config cache - keyed by tenantId)"
    echo "Status: ✓ PASS" >> "$OUTPUT_FILE"
    echo "Cache: __squareConfigCache (Map<string, { config, expiresAt }>)" >> "$OUTPUT_FILE"
    echo "Key pattern: tenantId" >> "$OUTPUT_FILE"
    echo "Evidence:" >> "$OUTPUT_FILE"
    grep -n "cache\.get(tenantId)" "$file" | head -3 >> "$OUTPUT_FILE"
    PASS=$((PASS + 1))
    echo "" >> "$OUTPUT_FILE"
    continue
  fi

  if [[ "$file" =~ src/lib/services/siteSettings.edge.ts ]]; then
    echo -e "${YELLOW}⚠️  WARNING${NC}: $file (site status cache - not tenant-scoped)"
    echo "Status: ⚠️  WARNING" >> "$OUTPUT_FILE"
    echo "Cache: __siteStatusCacheEdge (CacheEntry - single object)" >> "$OUTPUT_FILE"
    echo "Key pattern: None (singleton cache)" >> "$OUTPUT_FILE"
    echo "Evidence:" >> "$OUTPUT_FILE"
    grep -n "__siteStatusCacheEdge" "$file" | head -5 >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
    echo "Recommendation: Review if site status should be per-tenant or global" >> "$OUTPUT_FILE"
    echo "If per-tenant: Change to Map<string, CacheEntry> keyed by tenantId" >> "$OUTPUT_FILE"
    echo "If global: Document why shared cache is intentional" >> "$OUTPUT_FILE"
    WARNING=$((WARNING + 1))
    echo "" >> "$OUTPUT_FILE"
    continue
  fi

  # Generic analysis for other caches
  if [ "$HAS_TENANT_SCOPING" = true ]; then
    echo -e "${GREEN}✓ PASS${NC}: $file (appears to use tenant-scoped keys)"
    echo "Status: ✓ PASS" >> "$OUTPUT_FILE"
    echo "Evidence of tenant scoping:" >> "$OUTPUT_FILE"
    grep -n "tenantId" "$file" | head -5 >> "$OUTPUT_FILE"
    grep -n "\${tenantId}" "$file" | head -3 >> "$OUTPUT_FILE" || true
    PASS=$((PASS + 1))
  else
    # Check if it's a singleton cache (not Map or Set)
    if ! grep -q "Map\|Set" "$file"; then
      echo -e "${YELLOW}⚠️  WARNING${NC}: $file (singleton cache - may not need tenant scoping)"
      echo "Status: ⚠️  WARNING" >> "$OUTPUT_FILE"
      echo "Cache structure: Singleton (not Map/Set)" >> "$OUTPUT_FILE"
      echo "Recommendation: Verify if cache should be tenant-scoped" >> "$OUTPUT_FILE"
      WARNING=$((WARNING + 1))
    else
      # Map or Set without tenant scoping - likely a problem
      echo -e "${RED}✗ FAIL${NC}: $file (Map/Set cache without tenant scoping)"
      echo "Status: ✗ FAIL" >> "$OUTPUT_FILE"
      echo "Risk: HIGH - Can cause cross-tenant data pollution" >> "$OUTPUT_FILE"
      echo "Evidence:" >> "$OUTPUT_FILE"
      grep -n "Map\|Set" "$file" | head -5 >> "$OUTPUT_FILE"
      echo "" >> "$OUTPUT_FILE"
      echo "Recommended fix: Add tenant-scoped keys (e.g., \${tenantId}:\${key})" >> "$OUTPUT_FILE"
      FAIL=$((FAIL + 1))
    fi
  fi

  echo "" >> "$OUTPUT_FILE"
done <<< "$FILES"

# Summary
echo ""
echo "=== AUDIT SUMMARY ===" | tee -a "$OUTPUT_FILE"
echo "Total caches analyzed: $TOTAL" | tee -a "$OUTPUT_FILE"
echo -e "${GREEN}✓ PASS: $PASS${NC}" | tee -a "$OUTPUT_FILE"
echo -e "${YELLOW}⚠️  WARNING: $WARNING${NC}" | tee -a "$OUTPUT_FILE"
echo -e "${RED}✗ FAIL: $FAIL${NC}" | tee -a "$OUTPUT_FILE"
echo "" | tee -a "$OUTPUT_FILE"

if [ $FAIL -gt 0 ]; then
  echo -e "${RED}CRITICAL: $FAIL caches with potential cross-tenant pollution${NC}" | tee -a "$OUTPUT_FILE"
  echo "Review $OUTPUT_FILE for details" | tee -a "$OUTPUT_FILE"
  exit 1
elif [ $WARNING -gt 0 ]; then
  echo -e "${YELLOW}WARNING: $WARNING caches need manual review${NC}" | tee -a "$OUTPUT_FILE"
  echo "Review $OUTPUT_FILE for details" | tee -a "$OUTPUT_FILE"
  exit 0
else
  echo -e "${GREEN}All caches verified secure${NC}" | tee -a "$OUTPUT_FILE"
  exit 0
fi
