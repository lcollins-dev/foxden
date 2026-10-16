#!/bin/bash
set -e

source "$(dirname "$0")/env.sh"

API_PID_FILE="$LOG_DIR/api.pid"
API_WAS_RUNNING=false

if [[ -f "$API_PID_FILE" ]] && kill -0 "$(cat "$API_PID_FILE")" 2>/dev/null; then
  API_WAS_RUNNING=true
fi

echo "Cleaning database for instance ${INSTANCE} (.workdir/data/foxden.sqlite)..."

# The api keeps the file open, so it has to stop before the file goes and start again to migrate a new one.
if [[ "$API_WAS_RUNNING" == true ]]; then
  bash "$(dirname "$0")/stop.sh" api
fi

npm run db:clean --workspace=apps/api

if [[ "$API_WAS_RUNNING" == true ]]; then
  bash "$(dirname "$0")/start-all.sh"
fi
