#!/bin/sh
# Regenerates EnduvaAPIClient's committed sources from its openapi.json (a symlink to apps/api/openapi.json) with the
# generator CLI pinned in its Package.resolved. Run it after a spec change and commit the result; the swift-client CI
# job runs it and fails if anything changed.
set -eu
cd "$(dirname "$0")/../EnduvaAPIClient"
target=Sources/EnduvaAPIClient
rm -rf "$target/GeneratedSources"
swift run --force-resolved-versions swift-openapi-generator generate "$target/openapi.json" \
  --config "$target/openapi-generator-config.yaml" --output-directory "$target/GeneratedSources"
