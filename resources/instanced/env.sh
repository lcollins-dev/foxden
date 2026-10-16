#!/bin/bash
# Reads this worktree's fixed instance number (see instance.sh) and exports the derived ports and
# database path for use by the start/stop/db scripts.

INSTANCED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INSTANCE=$(bash "$INSTANCED_DIR/instance.sh")

if [[ -z "$INSTANCE" ]]; then
  echo "error: could not determine instance number" >&2
  exit 1
fi

WORKTREE_DIR=$(git rev-parse --show-toplevel)

WORKDIR="$WORKTREE_DIR/.workdir"
LOG_DIR="$WORKDIR/logs"

export INSTANCE
export WORKTREE_DIR
export WORKDIR
export LOG_DIR

export API_PORT=$((3000 + INSTANCE * 100))
export WEB_PORT=$((8080 + INSTANCE * 100))

# Vite serves the web app, and proxies the api's paths, on this origin.
export WEB_APP_BASE_URL="http://localhost:${WEB_PORT}"

export DATABASE_PATH="$WORKDIR/data/foxden.sqlite"
export BACKUP_PATH="$WORKDIR/data/backups"

export USE_TEST_MIGRATIONS=true

# The e2e suite runs every worker from one address, faster than the per-client limit allows.
export RATE_LIMIT_MAX_REQUESTS=100000
