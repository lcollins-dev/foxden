#!/bin/bash
set -e

# Runs the api integration suite. Each vitest pass migrates its own temporary SQLite file in
# the global setup, so nothing has to be running first.

API_DIR="$(dirname "$(cd "$(dirname "$0")" && pwd)")"

cd "$API_DIR"

# process.env wins over test.env, and a dev shell may have sourced the instance's env.sh.
export NODE_ENV=test
unset DATABASE_PATH WEB_ROOT_PATH

INTEGRATION_SERIAL=0 npx vitest run --config vitest.integration.config.ts

# Serial specs own their app, so they get a second process-isolated pass.
INTEGRATION_SERIAL=1 npx vitest run --config vitest.integration.config.ts --passWithNoTests
