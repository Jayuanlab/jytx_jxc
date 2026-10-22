#!/bin/sh
set -eu
umask 077
stage=/opt/store-erp/staging/capacity-20261010-v1
target=/opt/store-erp/app
rollback=/opt/store-erp/rollback/capacity-before-20261010
install -d -m 700 "$rollback"
if [ -e "$rollback/application.tgz" ]; then
 if [ "${1:-}" != "--resume" ]; then
  printf 'Existing rollback snapshot: use --resume after a verified rollback\n' >&2
  exit 1
 fi
 curl -fsS http://127.0.0.1:3100/health | grep -q '"storage":"sqlite"'
else
 tar -czf "$rollback/application.tgz" -C "$target" server/src web utils package.json package-lock.json
 cp /etc/systemd/system/store-erp.service "$rollback/service.unit"
 cp /etc/store-erp.env "$rollback/original.env"
fi
cp /opt/store-erp/capacity/runtime.env /opt/store-erp/capacity/production.env
sed -i 's/^PORT=3110$/PORT=3100/' /opt/store-erp/capacity/production.env
chmod 600 /opt/store-erp/capacity/production.env
systemctl stop store-erp-capacity
install -d -o storeerp -g storeerp "$target/server/src/capacity" "$target/server/migrations/postgres" "$target/scripts/capacity"
cp "$stage"/server/src/capacity/*.js "$target/server/src/capacity/"
for file in application.js repository.js auth-sessions.js local-credentials.js index.js common.js store-communication-events.js; do
 cp "$stage/server/src/$file" "$target/server/src/$file"
done
for file in organization.html organization.js organization.css branch-context.js office.js; do
 cp "$stage/web/$file" "$target/web/$file"
done
cp "$stage/package.json" "$stage/package-lock.json" "$target/"
cp "$stage/server/migrations/postgres/002_store_runtime.sql" "$target/server/migrations/postgres/"
cp "$stage"/scripts/capacity/*.cjs "$target/scripts/capacity/"
cp "$stage"/scripts/capacity/backup-postgres.sh "$target/scripts/capacity/"
chown -R storeerp:storeerp "$target/server/src/capacity" "$target/server/migrations/postgres" "$target/scripts/capacity"
for file in organization.html organization.js organization.css branch-context.js office.js; do
 chown storeerp:storeerp "$target/web/$file"
done
for file in application.js repository.js auth-sessions.js local-credentials.js index.js common.js store-communication-events.js; do
 chown storeerp:storeerp "$target/server/src/$file"
done
chown storeerp:storeerp "$target/package.json" "$target/package-lock.json"
runuser -u storeerp -- test -r "$target/server/src/capacity/postgres.js"
runuser -u storeerp -- test -r "$target/web/organization.js"
install -d /etc/systemd/system/store-erp.service.d
cat >/etc/systemd/system/store-erp.service.d/capacity.conf <<'UNIT'
[Unit]
After=postgresql.service
Requires=postgresql.service
[Service]
EnvironmentFile=/opt/store-erp/capacity/production.env
TimeoutStopSec=20
UNIT
cat >/etc/systemd/system/store-erp-postgres-backup.service <<'UNIT'
[Unit]
Description=Store ERP PostgreSQL backup
After=postgresql.service
Requires=postgresql.service
[Service]
Type=oneshot
User=root
ExecStart=/bin/sh /opt/store-erp/app/scripts/capacity/backup-postgres.sh
UNIT
cat >/etc/systemd/system/store-erp-postgres-backup.timer <<'UNIT'
[Unit]
Description=Store ERP daily PostgreSQL backup
[Timer]
OnCalendar=*-*-* 03:30:00 Asia/Shanghai
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl restart store-erp
sleep 2
if ! curl -fsS http://127.0.0.1:3100/health | grep -q '"storage":"postgresql"'; then
 printf 'New runtime unhealthy; restoring previous application\n' >&2
 tar -xzf "$rollback/application.tgz" -C "$target"
 rm -f /etc/systemd/system/store-erp.service.d/capacity.conf
 systemctl daemon-reload
 systemctl restart store-erp
 exit 1
fi
systemctl enable --now store-erp-postgres-backup.timer >/dev/null
systemctl start store-erp-postgres-backup.service
printf '\nExpansion runtime published; old SQLite data remains intact.\n'
