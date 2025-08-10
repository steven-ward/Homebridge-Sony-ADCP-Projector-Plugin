#!/usr/bin/env bash
set -euo pipefail

echo "📦 Homebridge Sony ADCP Projector – Publish Script"
echo "--------------------------------------------------"

# --- Helpers ---------------------------------------------------------------

die() { echo "❌ $*" >&2; exit 1; }
confirm_clean_worktree() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "⚠️  You have uncommitted changes."
    read -r -p "Continue anyway? [y/N] " yn
    [[ "${yn:-N}" =~ ^[Yy]$ ]] || die "Aborted."
  fi
}

get_default_branch() {
  if git rev-parse --verify main >/dev/null 2>&1; then echo "main"; else echo "master"; fi
}

repo_root() { git rev-parse --show-toplevel; }

get_origin_https() {
  local url
  url=$(git config --get remote.origin.url || echo "")
  # Normalize to https://host/owner/repo
  if [[ "$url" =~ ^git@([^:]+):(.+)\.git$ ]]; then
    echo "https://${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  elif [[ "$url" =~ ^https?:// ]]; then
    echo "${url%.git}"
  else
    echo ""
  fi
}

today() { date +"%Y-%m-%d"; }

# --- Start -----------------------------------------------------------------

cd "$(repo_root)"

BRANCH=$(get_default_branch)
echo "🪵 Using branch: $BRANCH"

confirm_clean_worktree

echo "⬇️  Pulling latest from origin/$BRANCH..."
git pull --rebase origin "$BRANCH"

# Choose bump
echo "🔢 Select version bump:"
select BUMP in patch minor major; do
  [[ -n "${BUMP:-}" ]] && break
  echo "Please choose 1, 2, or 3."
done
echo "🔼 Bumping version ($BUMP) without tagging yet..."

# Bump package.json/package-lock.json but DO NOT tag/commit yet
NEW_VERSION=$(npm --no-git-tag-version version "$BUMP" | sed 's/^v//')
echo "📌 New version: v$NEW_VERSION"

# Figure out previous tag (if any)
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [[ -z "$LAST_TAG" ]]; then
  LOG_RANGE=""
  echo "📝 No prior tag found — generating changelog from initial commit."
else
  LOG_RANGE="${LAST_TAG}..HEAD"
  echo "📝 Generating changelog from ${LAST_TAG} → HEAD."
fi

# Build commit list (skip merge noise)
COMMITS=$(git log --no-merges --pretty=format:"- %s (%h)" ${LOG_RANGE:+$LOG_RANGE} || true)
if [[ -z "$COMMITS" ]]; then
  COMMITS="- Internal changes only."
fi

# Prepare compare link (if remote is GitHub-like and we have a previous tag)
ORIGIN_HTTPS=$(get_origin_https)
if [[ -n "$ORIGIN_HTTPS" && -n "$LAST_TAG" ]]; then
  COMPARE_LINK="${ORIGIN_HTTPS}/compare/${LAST_TAG}...v${NEW_VERSION}"
else
  COMPARE_LINK=""
fi

# Update CHANGELOG.md (prepend new section)
CHANGELOG_FILE="CHANGELOG.md"
TMP_FILE="$(mktemp)"

{
  echo "# Changelog"
  echo
  echo "## v${NEW_VERSION} – $(today)"
  echo
  echo "${COMMITS}"
  if [[ -n "$COMPARE_LINK" ]]; then
    echo
    echo "[Compare changes](${COMPARE_LINK})"
  fi
  echo
  if [[ -f "$CHANGELOG_FILE" ]]; then
    # Append previous content excluding an existing top-level H1 to avoid duplicates
    awk 'NR==1 && $0 ~ /^# Changelog$/ { next } { print }' "$CHANGELOG_FILE"
  fi
} > "$TMP_FILE"

mv "$TMP_FILE" "$CHANGELOG_FILE"

echo "🧾 Updated $CHANGELOG_FILE with v$NEW_VERSION entries."

# Commit and tag release
git add package.json package-lock.json "$CHANGELOG_FILE" 2>/dev/null || true
git commit -m "chore(release): v${NEW_VERSION}"
git tag "v${NEW_VERSION}"

# Build if available
if npm run | grep -qE '^  build'; then
  echo "🏗  Running build..."
  npm run build
else
  echo "⚠️  No build script found. Skipping build."
fi

# Publish (handle 2FA optionally)
echo
read -r -p "If your npm account uses 2FA for publishing, paste OTP now (or leave blank): " NPM_OTP
echo "🚀 Publishing v${NEW_VERSION} to npm..."
if [[ -n "${NPM_OTP// }" ]]; then
  npm publish --access public --otp "$NPM_OTP"
else
  npm publish --access public
fi

# Push commits + tags
echo "📤 Pushing commits and tags to origin/$BRANCH..."
git push origin "$BRANCH" --tags

echo "✅ Done! Published v${NEW_VERSION}"