#!/bin/bash
set -e
DB_PATH="${DB_PATH:-/opt/cistracker/data/cistracker.db}"
BACKUP_DIR="$(dirname "$DB_PATH")"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DEST="$BACKUP_DIR/cistracker.db.bak-$TIMESTAMP"
cp "$DB_PATH" "$DEST"
echo "Backup created: $DEST"
