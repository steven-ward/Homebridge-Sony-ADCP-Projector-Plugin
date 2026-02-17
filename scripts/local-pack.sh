#!/bin/sh
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 /path/to/homebridge/plugins/directory [backup-dir] [restart-command] [remote-host]"
  exit 1
fi

TARGET_DIR="$(cd "$1" && pwd)"
BACKUP_DIR="${2:-}"
RESTART_CMD="${3:-}"
REMOTE_HOST="${4:-}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "==> Packaging plugin from $PROJECT_ROOT"
TARBALL="$(npm pack | tail -n 1)"
echo "==> Created $TARBALL"

if [ -n "$BACKUP_DIR" ]; then
  mkdir -p "$BACKUP_DIR"
  echo "==> Backing up current plugin from $TARGET_DIR to $BACKUP_DIR (excluding node_modules)"
  rsync -av --exclude 'node_modules/' "$TARGET_DIR/" "$BACKUP_DIR/"
fi

echo "==> Cleaning target directory $TARGET_DIR"
rm -rf "$TARGET_DIR"/*

echo "==> Extracting $TARBALL into $TARGET_DIR"
tar -xzf "$TARBALL" -C "$TARGET_DIR" --strip-components=1

if [ -n "$RESTART_CMD" ]; then
  if [ -n "$REMOTE_HOST" ]; then
    echo "==> Restarting Homebridge on $REMOTE_HOST with: $RESTART_CMD"
    ssh "$REMOTE_HOST" "$RESTART_CMD"
  else
    echo "==> Restarting Homebridge with: $RESTART_CMD"
    sh -c "$RESTART_CMD"
  fi
fi

echo "Done."
