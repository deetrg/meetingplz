#!/usr/bin/env bash
# Usage: upload-asset.sh <release-id> <file> <asset-name>   (needs GH_TOKEN and GITHUB_REPOSITORY)
set -euo pipefail
ID="$1"; FILE="$2"; NAME="$3"
# remove an older asset with the same name
OLD=$(gh api "repos/$GITHUB_REPOSITORY/releases/$ID/assets" --paginate --jq ".[] | select(.name==\"$NAME\") | .id" || true)
for a in $OLD; do gh api -X DELETE "repos/$GITHUB_REPOSITORY/releases/assets/$a" >/dev/null; done
gh api -X POST "https://uploads.github.com/repos/$GITHUB_REPOSITORY/releases/$ID/assets?name=$NAME" \
  -H "Content-Type: application/octet-stream" --input "$FILE" --jq '.browser_download_url'
