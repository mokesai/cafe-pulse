#!/bin/bash
# review-staged.sh — Review staged git changes using Claude Code headlessly
#
# Usage:
#   ./scripts/review-staged.sh          # Review staged changes
#   ./scripts/review-staged.sh --full   # Include unstaged changes too
#
# Requires: claude CLI installed and ANTHROPIC_API_KEY set

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Staged Changes Review (powered by Claude)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if claude is installed
if ! command -v claude &> /dev/null; then
    echo -e "${RED}Error: claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code${NC}"
    exit 1
fi

# Check if we're in a git repo
if ! git rev-parse --is-inside-work-tree &> /dev/null; then
    echo -e "${RED}Error: Not inside a git repository${NC}"
    exit 1
fi

# Get the diff
if [[ "${1:-}" == "--full" ]]; then
    DIFF=$(git diff HEAD)
    DIFF_TYPE="all uncommitted"
else
    DIFF=$(git diff --staged)
    DIFF_TYPE="staged"
fi

# Check if there are changes
if [ -z "$DIFF" ]; then
    echo -e "${YELLOW}No ${DIFF_TYPE} changes to review.${NC}"
    if [[ "${1:-}" != "--full" ]]; then
        echo -e "Tip: Use ${CYAN}git add <files>${NC} to stage changes, or ${CYAN}--full${NC} to review all uncommitted changes."
    fi
    exit 0
fi

# Count files changed
FILES_CHANGED=$(echo "$DIFF" | grep -c '^diff --git' || true)
LINES_ADDED=$(echo "$DIFF" | grep -c '^+[^+]' || true)
LINES_REMOVED=$(echo "$DIFF" | grep -c '^-[^-]' || true)

echo -e "Reviewing ${GREEN}${FILES_CHANGED}${NC} files (${GREEN}+${LINES_ADDED}${NC} / ${RED}-${LINES_REMOVED}${NC} lines)"
echo ""

# Send to Claude for review
echo "$DIFF" | claude -p "You are reviewing a git diff of ${DIFF_TYPE} changes. Be concise and actionable.

Review this diff for:

1. **Bugs & Logic Errors** — Incorrect logic, off-by-one errors, null/undefined risks, race conditions
2. **Security Issues** — Hardcoded secrets, API keys, SQL injection, XSS, exposed credentials
3. **Performance** — N+1 queries, unnecessary re-renders, missing indexes, large bundle additions
4. **Code Quality** — Dead code, unclear naming, missing error handling at system boundaries

Format your response as:

## Summary
One sentence describing the overall change.

## Issues Found
List each issue with severity (🔴 Critical, 🟡 Warning, 🔵 Info):
- [severity] **file:line** — Description of the issue

## Verdict
Either: ✅ LGTM — Good to commit
Or: ⚠️ REVIEW — Issues should be addressed before committing

If no issues found, just say ✅ LGTM with a brief note about what looks good." \
  --model sonnet --max-turns 1

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
