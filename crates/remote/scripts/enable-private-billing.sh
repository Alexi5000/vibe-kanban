#!/usr/bin/env bash
# Opt the remote crate into the private hosted-billing implementation.
#
# The public crates/remote/Cargo.toml deliberately does not reference the
# private BloopAI/vibe-kanban-private repository, so the public build and the
# committed Cargo.lock resolve without access to private source. Builds that DO
# have access (hosted deployments with an SSH deploy key loaded) run this script
# before `cargo build --features vk-billing`. It:
#
#   1. adds the optional `billing` git dependency to crates/remote/Cargo.toml,
#      pinned to VK_BILLING_REV (defaults to the commit the lockfile pinned
#      before the dependency was removed from the public manifest), and
#   2. rewrites the `vk-billing` feature to `["dep:billing"]`, and
#   3. (unless --no-lock) runs `cargo metadata` so Cargo.lock gains the billing
#      subtree while every already-locked package keeps its version.
#
# The edit is local to the build checkout; do not commit the result.
# The script is idempotent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$REMOTE_DIR/Cargo.toml"

BILLING_GIT="ssh://git@github.com/BloopAI/vibe-kanban-private"
BILLING_REV="${VK_BILLING_REV:-020091913ce5608d6c8bdb667d124fd22ab10561}"
UPDATE_LOCK=1

for arg in "$@"; do
  case "$arg" in
    --no-lock) UPDATE_LOCK=0 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ ! "$BILLING_REV" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "VK_BILLING_REV must be a git commit hash, got: $BILLING_REV" >&2
  exit 2
fi
case "$BILLING_GIT" in
  *\"*|*$'\n'*)
    echo "VK_BILLING_GIT contains invalid characters" >&2
    exit 2
    ;;
esac

if ! grep -q '^vk-billing = \["private-billing-source-missing"\]$' "$MANIFEST" \
  && ! grep -q '^vk-billing = \["dep:billing"\]$' "$MANIFEST"; then
  echo "unexpected vk-billing feature definition in $MANIFEST" >&2
  exit 1
fi

dep_line="billing = { git = \"$BILLING_GIT\", rev = \"$BILLING_REV\", package = \"billing\", optional = true }"
if grep -q '^billing = {' "$MANIFEST"; then
  if ! grep -Fxq "$dep_line" "$MANIFEST"; then
    echo "existing billing dependency does not match requested source/revision; use a clean build checkout" >&2
    exit 1
  fi
  echo "billing dependency already present in $MANIFEST"
else
  tmp="$(mktemp)"
  awk -v dep="$dep_line" '
    { print }
    $0 == "[dependencies]" && !done { print dep; done = 1 }
    END { if (!done) exit 1 }
  ' "$MANIFEST" >"$tmp" || {
    rm -f "$tmp"
    echo "no [dependencies] table found in $MANIFEST" >&2
    exit 1
  }
  cat "$tmp" >"$MANIFEST"
  rm -f "$tmp"
  echo "added private billing dependency at rev $BILLING_REV"
fi

tmp="$(mktemp)"
sed -e 's/^vk-billing = \["private-billing-source-missing"\]$/vk-billing = ["dep:billing"]/' \
  -e '/^# Internal marker; do not enable directly\.$/d' \
  -e '/^private-billing-source-missing = \[\]$/d' \
  "$MANIFEST" >"$tmp"
cat "$tmp" >"$MANIFEST"
rm -f "$tmp"

if [ "$UPDATE_LOCK" -eq 1 ]; then
  cargo metadata --format-version 1 --manifest-path "$MANIFEST" >/dev/null
  echo "Cargo.lock updated with the private billing subtree"
fi
