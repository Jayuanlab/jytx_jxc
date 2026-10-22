#!/bin/sh
set -eu
umask 077
# Compatibility entry; systemd invokes the protected root-owned verifier directly.
exec /usr/bin/python3 /opt/store-erp/operations/backup-integrity.py backup
