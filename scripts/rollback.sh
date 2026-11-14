#!/usr/bin/env bash
# Puts the code back exactly as it was at a tag or commit, as ONE new commit on top of the branch (history is kept, nothing is
# rewritten, so auto-deploy picks it up like any other change and you can roll forward again the same way).
#   scripts/rollback.sh before-tonight           preview only (shows what would change)
#   scripts/rollback.sh before-tonight --apply   restore, commit and push
#   scripts/rollback.sh                          lists the restore points (docs/rollback-points.txt)
# Only code and design change. Data in the database is untouched (see docs/ROLLBACK-AND-RESET.md).
set -euo pipefail
cd "$(dirname "$0")/.."
ref="${1:-}"; apply="${2:-}"
pts=docs/rollback-points.txt
[ -n "$ref" ] || { echo "Usage: scripts/rollback.sh <name-or-commit> [--apply]"; echo "Restore points:"; grep -v '^#' "$pts" | sed 's/^/  /'; exit 1; }
# a restore-point name from docs/rollback-points.txt, or any tag / commit
named="$(grep -v '^#' "$pts" 2>/dev/null | awk -v n="$ref" '$1==n{print $2}')"; [ -n "$named" ] && ref="$named"
git rev-parse --verify -q "$ref^{commit}" >/dev/null || { echo "Unknown tag or commit: $ref"; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "You have uncommitted changes. Commit or stash them first."; exit 1; }
branch="$(git rev-parse --abbrev-ref HEAD)"
echo "Branch: $branch   rolling back to: $ref ($(git rev-parse --short "$ref^{commit}"))"
git diff --stat "$ref" HEAD | tail -n 25
[ "$apply" = "--apply" ] || { echo; echo "Preview only. Add --apply to restore this version."; exit 0; }
git checkout "$ref" -- .
# files created after the tag are removed too, so the tree matches the tag exactly
git diff --name-only --diff-filter=A "$ref" HEAD | while read -r f; do [ -n "$f" ] && git rm -q -f -- "$f" || true; done
# the rollback and reset tools themselves always stay, so you can use them again afterwards
git checkout HEAD -- scripts/rollback.sh scripts/reset-keep-admin.cjs docs/ROLLBACK-AND-RESET.md test/reset-script.test.cjs docs/rollback-points.txt 2>/dev/null || true
git commit -q -m "Roll back to $ref" -m "Restores the files exactly as they were at $ref. Roll forward again with: scripts/rollback.sh <newer tag or commit> --apply"
git push -u origin "$branch"
echo "Rolled back to $ref and pushed. Auto-deploy will rebuild within about 2 minutes."
