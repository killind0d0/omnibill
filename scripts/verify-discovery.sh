#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== [1/8] Running cargo test --all ==="
(cd src-tauri && cargo test --all)

echo "=== [2/8] Running cargo clippy --all-targets -- -D warnings ==="
(cd src-tauri && cargo clippy --all-targets -- -D warnings)

echo "=== [3/8] Running cargo fmt --check ==="
(cd src-tauri && cargo fmt --check)

echo "=== [4/8] Running TypeScript typecheck (tsc --noEmit) ==="
(cd ui && npx tsc --noEmit)

echo "=== [5/8] Running UI test suite ==="
(cd ui && npm test)

echo "=== [6/8] Running UI production build ==="
(cd ui && npm run build)

echo "=== [7/8] Grepping for floating-point usage in discovery backend ==="
if grep -rnE "\bf(32|64)\b|as f(32|64)" src-tauri/src/discovery; then
    echo "ERROR: Floating point found in src-tauri/src/discovery!"
    exit 1
else
    echo "NO_RUST_FLOATS in discovery backend."
fi

echo "=== [8/8] Verifying zero external charting libraries ==="
if grep -rnE "\b(recharts|chart\.js|d3|victory|nivo|chartjs)\b" ui/package.json ui/src/features/charts; then
    echo "ERROR: Chart library found!"
    exit 1
else
    echo "ZERO external chart libraries verified (pure SVG components)."
fi

echo "============================================================"
echo " ALL CHECKS PASSED"
echo "============================================================"
