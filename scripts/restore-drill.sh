#!/usr/bin/env bash
# Restore drill: back up the source DB, restore into a scratch DB, compare row counts.
# Usage: DATABASE_URL=... ADMIN_DATABASE_URL=postgres://.../postgres BACKUP_PASSPHRASE_FILE=... scripts/restore-drill.sh
set -euo pipefail
: "${DATABASE_URL:?}"; : "${ADMIN_DATABASE_URL:?}"; : "${BACKUP_PASSPHRASE_FILE:?}"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
scratch="wms_restore_drill_$(date +%s)"
file="$("$here/backup.sh" "$tmp")"
psql "$ADMIN_DATABASE_URL" -qc "create database $scratch"
cleanup() { psql "$ADMIN_DATABASE_URL" -qc "drop database if exists $scratch" || true; rm -rf "$tmp"; }
trap cleanup EXIT
target="${ADMIN_DATABASE_URL%/*}/$scratch"
TARGET_DATABASE_URL="$target" "$here/restore.sh" "$file" >/dev/null
q="select 'users='||count(*) from platform.users union all select 'audit_log='||count(*) from platform.audit_log union all select 'outbox='||count(*) from platform.outbox"
src="$(psql "$DATABASE_URL" -Atc "$q")"
dst="$(psql "$target" -Atc "$q")"
if [ "$src" != "$dst" ]; then
  echo "RESTORE DRILL FAILED"; echo "source: $src"; echo "restored: $dst"; exit 1
fi
echo "RESTORE DRILL PASSED"; echo "$dst"
