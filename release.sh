#!/usr/bin/env bash
set -euo pipefail

BUMP="${1:-}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: release.sh <patch|minor|major>"
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: must be on main branch (currently on $BRANCH)"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean"
  git status --short
  exit 1
fi

VERSION=$(npm version "$BUMP" --no-git-tag-version | tr -d 'v')
echo "Releasing v$VERSION"

npm install --package-lock-only
npm run build

if ! npm publish; then
  echo "npm publish failed, reverting version bump"
  git checkout package.json
  exit 1
fi

git add package.json package-lock.json
git commit -m "v$VERSION"
git tag "v$VERSION"
git push && git push --tags

gh release create "v$VERSION" --title "v$VERSION" --generate-notes

echo "Released v$VERSION"
