#!/bin/bash
set -e

# Deletes the SQLite database, WAL and shared-memory files included. The api migrates a fresh
# one on its next start. Stop the api first - it keeps the deleted file open.

DATABASE_PATH=${DATABASE_PATH:-data/foxden.sqlite}

echo "Deleting ${DATABASE_PATH}..."

rm -f "$DATABASE_PATH" "$DATABASE_PATH-wal" "$DATABASE_PATH-shm"

echo "Done"
