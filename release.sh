#!/usr/bin/env bash
set -euo pipefail

BUMP="${1:-}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: release.sh <patch|minor|major>"
  exit 1
fi

# Must be on main
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: must be on main branch (currently on $BRANCH)"
  exit 1
fi

# Must have clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean"
  git status --short
  exit 1
fi

# Bump version (package.json only, no git tag yet)
VERSION=$(npm version "$BUMP" --no-git-tag-version | tr -d 'v')
echo "Releasing v$VERSION"

# Build
npm run build

# Publish to npm — abort everything if this fails
if ! npm publish; then
  echo "npm publish failed, reverting version bump"
  git checkout package.json
  exit 1
fi

# Commit, tag, push
git add package.json
git commit -m "v$VERSION"
git tag "v$VERSION"
git push && git push --tags

# GitHub release
gh release create "v$VERSION" --title "v$VERSION" --generate-notes

echo "Released v$VERSION"
