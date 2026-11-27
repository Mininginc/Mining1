#!/usr/bin/env bash
# Restore an encrypted backup into an EMPTY target database.
# Usage: TARGET_DATABASE_URL=... BACKUP_PASSPHRASE_FILE=... scripts/restore.sh <file.dump.enc>
set -euo pipefail
: "${TARGET_DATABASE_URL:?set TARGET_DATABASE_URL}"
: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE}"
file="${1:?backup file required}"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$file" \
  | pg_restore --no-owner --exit-on-error --dbname="$TARGET_DATABASE_URL"
echo "Restored $file"
