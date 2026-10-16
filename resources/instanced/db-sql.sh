#!/bin/bash
set -e

source "$(dirname "$0")/env.sh"

if [[ ! -f "$DATABASE_PATH" ]]; then
  echo "error: no database at ${DATABASE_PATH} - start the instance first: npm run instance:start" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "Opening sqlite3 shell for instance ${INSTANCE} (.workdir/data/foxden.sqlite)..."
fi

# The api holds the database open, so wait on its locks rather than failing at once.
exec sqlite3 -cmd '.timeout 5000' "$DATABASE_PATH" "$@"
