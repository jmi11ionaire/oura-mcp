#!/usr/bin/env bash
#
# oura-mcp health check
#
# Verifies that what is on disk agrees with what is actually running --
# the failure mode that has bitten this setup more than once (a stale
# build/ silently served six-week-old code while src/ was current).
#
# Usage:
#   ./scripts/healthcheck.sh            # skips checks needing secrets
#   OURA_PAT=xxx ./scripts/healthcheck.sh
#   OURA_PAT=xxx MCP_URL=https://host/<secret>/mcp ./scripts/healthcheck.sh
#
# Env:
#   OURA_PAT   Oura personal access token. Falls back to .env if unset.
#   MCP_URL    Full remote MCP endpoint incl. secret path. Optional.
#   FITSYNC_URL  FitSync web app exec URL. Optional.
#   EXPECT_TOOLS Expected read-only Oura tool count (default 35).
#
# Exits non-zero if any check fails. Skipped checks do not fail the run.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

EXPECT_TOOLS="${EXPECT_TOOLS:-35}"
FAIL=0
SKIP=0

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
skip() { printf '  \033[33mSKIP\033[0m  %s\n' "$1"; SKIP=$((SKIP+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Resolve PAT: explicit env wins, else .env
if [ -z "${OURA_PAT:-}" ] && [ -f .env ]; then
  OURA_PAT="$(grep -h '^OURA_PERSONAL_ACCESS_TOKEN=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
fi

# ---------------------------------------------------------------- repo
head_ "Repo"

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  fail "working tree has uncommitted changes"
else
  pass "working tree clean"
fi

BRANCH="$(git branch --show-current 2>/dev/null)"
if git fetch -q origin 2>/dev/null; then
  AHEAD="$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 0)"
  BEHIND="$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo 0)"
  if [ "$AHEAD" = "0" ] && [ "$BEHIND" = "0" ]; then
    pass "in sync with origin/$BRANCH"
  else
    fail "diverged from origin/$BRANCH (ahead $AHEAD, behind $BEHIND)"
  fi
else
  skip "could not reach origin"
fi

# Deployment files must stay tracked -- they were lost once by being untracked.
MISSING=""
for f in src/server.ts Dockerfile fly.toml; do
  git ls-files --error-unmatch "$f" >/dev/null 2>&1 || MISSING="$MISSING $f"
done
if [ -z "$MISSING" ]; then
  pass "deployment files tracked (src/server.ts, Dockerfile, fly.toml)"
else
  fail "deployment files NOT tracked:$MISSING"
fi

# ---------------------------------------------------------------- build
head_ "Build"

if [ ! -f build/index.js ]; then
  fail "build/index.js missing -- run: npm run build"
else
  STALE="$(find src -name '*.ts' -not -path '*__tests__*' -newer build/index.js 2>/dev/null | head -5)"
  if [ -z "$STALE" ]; then
    pass "build/ newer than all src/ (no drift)"
  else
    fail "STALE BUILD -- these src files are newer than build/index.js:"
    echo "$STALE" | sed 's/^/          /'
    echo "          fix: npm run build"
  fi
fi

[ -f build/server.js ] && pass "build/server.js present (HTTP entry)" \
                       || fail "build/server.js missing -- run: npm run build"

# ---------------------------------------------------------------- tests
head_ "Tests"
if npm test >/tmp/oura_hc_tests.log 2>&1; then
  pass "$(grep -E '^Tests:' /tmp/oura_hc_tests.log | head -1 | sed 's/Tests: *//')"
else
  fail "test suite failing (see /tmp/oura_hc_tests.log)"
fi

# ------------------------------------------------------------ local mcp
head_ "Local MCP (stdio)"

if [ -z "${OURA_PAT:-}" ]; then
  skip "no OURA_PAT -- set it or populate .env"
elif [ ! -f build/index.js ]; then
  skip "no build to test"
else
  COUNT="$(printf '%s\n%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"hc","version":"1"}}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
    | OURA_PERSONAL_ACCESS_TOKEN="$OURA_PAT" node build/index.js 2>/dev/null \
    | tail -1 | jq -r '.result.tools | length' 2>/dev/null)"
  if [ "$COUNT" = "$EXPECT_TOOLS" ]; then
    pass "$COUNT tools"
  else
    fail "expected $EXPECT_TOOLS tools, got '${COUNT:-none}' (stale build? rebuild and retry)"
  fi
fi

# -------------------------------------------------------------- oura api
head_ "Oura API"
if [ -z "${OURA_PAT:-}" ]; then
  skip "no OURA_PAT"
else
  CODE="$(curl -s -m 20 -o /dev/null -w '%{http_code}' \
    https://api.ouraring.com/v2/usercollection/personal_info \
    -H "Authorization: Bearer $OURA_PAT" 2>/dev/null)"
  case "$CODE" in
    200) pass "PAT valid (HTTP 200)" ;;
    401) fail "PAT rejected (HTTP 401) -- rotate in .env, Claude Desktop config, AND Fly secrets" ;;
    *)   fail "unexpected HTTP $CODE from Oura" ;;
  esac
fi

# --------------------------------------------------- desktop config drift
head_ "Claude Desktop config"
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
if [ ! -f "$CFG" ]; then
  skip "config not found (not this machine?)"
else
  CFG_PATH="$(python3 -c "
import json,sys
try:
    c=json.load(open(sys.argv[1]))['mcpServers']['oura-mcp']
    print(c['args'][0])
except Exception: print('')
" "$CFG" 2>/dev/null)"
  CFG_TOK="$(python3 -c "
import json,sys
try:
    c=json.load(open(sys.argv[1]))['mcpServers']['oura-mcp']
    print(c.get('env',{}).get('OURA_PERSONAL_ACCESS_TOKEN',''))
except Exception: print('')
" "$CFG" 2>/dev/null)"

  if [ -z "$CFG_PATH" ]; then
    fail "no oura-mcp entry in Claude Desktop config"
  elif [ ! -f "$CFG_PATH" ]; then
    fail "config points at a nonexistent path: $CFG_PATH"
  elif [ "$CFG_PATH" != "$REPO/build/index.js" ]; then
    fail "config points at $CFG_PATH but this repo is $REPO"
  else
    pass "config points at this repo's build"
  fi

  if [ -n "${OURA_PAT:-}" ] && [ -n "$CFG_TOK" ]; then
    [ "$CFG_TOK" = "$OURA_PAT" ] && pass "config PAT matches .env" \
                                 || fail "config PAT differs from .env (rotation missed a location)"
  fi
fi

# ------------------------------------------------------------ remote mcp
head_ "Remote MCP (Fly)"
if [ -z "${MCP_URL:-}" ]; then
  skip "MCP_URL unset -- export MCP_URL=https://oura-mcp-jesse.fly.dev/<secret>/mcp"
else
  BASE="${MCP_URL%/*}"; BASE="${BASE%/*}"
  H="$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null)"
  [ "$H" = "200" ] && pass "health HTTP 200" || fail "health HTTP ${H:-unreachable}"

  RCOUNT="$(curl -s -m 30 -X POST "$MCP_URL" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' 2>/dev/null \
    | grep '^data: ' | sed 's/^data: //' | jq -r '.result.tools | length' 2>/dev/null)"
  if [ "$RCOUNT" = "$EXPECT_TOOLS" ]; then
    pass "$RCOUNT tools -- at parity with local"
  else
    fail "remote has '${RCOUNT:-none}' tools, expected $EXPECT_TOOLS -- redeploy: npm run deploy"
  fi
fi

# --------------------------------------------------------------- fitsync
head_ "FitSync web app"
if [ -z "${FITSYNC_URL:-}" ]; then
  skip "FITSYNC_URL unset"
else
  V="$(curl -sL -m 30 "$FITSYNC_URL?action=version" 2>/dev/null)"
  if echo "$V" | grep -q '"version"'; then
    pass "$(echo "$V" | tr -d '{}"')"
  else
    fail "no version JSON returned (stale deployment or HTML error page)"
  fi
fi

# ---------------------------------------------------------------- result
echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32mAll checks passed\033[0m'
  [ "$SKIP" -gt 0 ] && printf ' (%d skipped)' "$SKIP"
  echo; exit 0
else
  printf '\033[31m%d check(s) failed\033[0m' "$FAIL"
  [ "$SKIP" -gt 0 ] && printf ' (%d skipped)' "$SKIP"
  echo; exit 1
fi
