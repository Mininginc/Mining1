# Backup and restore runbook

Serves: Data backups (5), Cybersecurity (5).

## Policy (proposed, confirm when hosting is chosen)
- Managed PostgreSQL with point-in-time recovery (at least 7 days).
- Plus a nightly encrypted logical backup (`scripts/backup.sh`) copied to storage in a different account/region, kept 35 days.
- Monthly restore drill (`scripts/restore-drill.sh`); record the result below.
- The passphrase lives in the password manager, not in the repo or on the database server.

## Commands
```bash
# Backup
DATABASE_URL=postgres://... BACKUP_PASSPHRASE_FILE=~/secrets/wms-backup scripts/backup.sh ./backups
# Restore into an empty database
TARGET_DATABASE_URL=postgres://.../wms_restored BACKUP_PASSPHRASE_FILE=~/secrets/wms-backup scripts/restore.sh backups/wms-....dump.enc
# Drill: backup, restore into a scratch DB, compare row counts, drop the scratch DB
DATABASE_URL=postgres://.../wms ADMIN_DATABASE_URL=postgres://.../postgres BACKUP_PASSPHRASE_FILE=... scripts/restore-drill.sh
```

## Drill log
| Date | Who | Result | Notes |
| --- | --- | --- | --- |
| 2026-11-27 | Claude (Phase 0 build) | Passed: users=1, audit_log=2, outbox=0 | Local dev database |
