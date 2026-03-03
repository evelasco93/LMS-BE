#!/usr/bin/env bash

# Dynamic handler test runner: executes a command in every handler folder containing a package.json.
# Discovers handler packages recursively under ./handlers (supports nested paths like handlers/qa/**).
# Usage: ./scripts/run-handler-tests.sh [--pattern <glob>] [--cmd "npm test"]
# Defaults: pattern="*" , cmd="npm test"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
HANDLERS_DIR="${ROOT_DIR}/handlers"

PATTERN="*"
CMD="npm test"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pattern)
      PATTERN="$2"; shift 2 ;;
    --cmd)
      CMD="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ ! -d "$HANDLERS_DIR" ]; then
  echo "Handlers directory not found: $HANDLERS_DIR" >&2
  exit 1
fi

STATUS=0

mapfile -t handler_package_dirs < <(
  find "$HANDLERS_DIR" \
    -type f \
    -name "package.json" \
    -not -path "*/node_modules/*" \
    -not -path "*/coverage/*" \
    -exec dirname {} \; | sort
)

matched=0
for dir in "${handler_package_dirs[@]}"; do
  rel_dir="${dir#${HANDLERS_DIR}/}"

  if [[ "$rel_dir" != $PATTERN ]]; then
    continue
  fi

  matched=1
  echo "============================================"
  echo "→ Running tests for handler: $rel_dir"
  echo "   Command: $CMD"
  echo "============================================"

  pushd "$dir" >/dev/null
  if ! eval "$CMD"; then
    echo "✗ Tests failed for $rel_dir" >&2
    STATUS=1
  else
    echo "✓ Tests passed for $rel_dir"
  fi
  popd >/dev/null
done

if [ "$matched" -eq 0 ]; then
  echo "No handler package matched pattern '$PATTERN' under $HANDLERS_DIR" >&2
  exit 1
fi

exit $STATUS
