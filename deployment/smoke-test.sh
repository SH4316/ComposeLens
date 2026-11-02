#!/bin/sh
set -eu

base_url="${1:-http://127.0.0.1:8080}"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

expect_status() {
    expected="$1"
    route="$2"
    shift 2
    actual="$(curl --silent --show-error --max-time 15 -D "$test_dir/headers" \
        -o "$test_dir/body" -w '%{http_code}' "$@" "$base_url$route")"
    if [ "$actual" != "$expected" ]; then
        echo "Expected $expected for $route; received $actual" >&2
        cat "$test_dir/body" >&2
        exit 1
    fi
}

expect_json() {
    grep -qi '^content-type: application/json' "$test_dir/headers"
}

expect_status 200 /healthz
grep -qx 'ok' "$test_dir/body"

expect_status 200 '/?url=https%3A%2F%2Fgithub.com%2Fexample%2Fstack&compose=deploy%2Fcompose.yml'
grep -q '<div id="root"></div>' "$test_dir/body"
cp "$test_dir/body" "$test_dir/index"

expect_status 200 '/inspect/shared?compose=deploy%2Fcompose.yml'
cmp "$test_dir/index" "$test_dir/body"
grep -qi '^cache-control: no-cache' "$test_dir/headers"

asset="$(sed -n 's/.*src="\(\/assets\/[^" ]*\.js\)".*/\1/p' "$test_dir/index")"
test -n "$asset"
expect_status 200 "$asset"
grep -qi '^cache-control: .*immutable' "$test_dir/headers"
expect_status 404 /assets/does-not-exist.js

expect_status 400 /api/images
expect_json
grep -q 'reference' "$test_dir/body"
expect_status 400 '/api/tags?repository=library%2Fnginx&page=0'
expect_json

# This response is local validation: it does not contact an external registry.
expect_status 200 '/api/images?reference=ghcr.io%2Fexample%2Fimage%3Alatest&platform=linux%2Farm64'
expect_json
grep -Eq '"status"[[:space:]]*:[[:space:]]*"unsupported"' "$test_dir/body"

expect_status 405 /api/images -X POST
expect_json
grep -qi '^allow: GET' "$test_dir/headers"
expect_status 404 /api/does-not-exist
expect_json
expect_status 404 /api
expect_json

echo 'Nginx static assets, SPA fallback, and backend API routing passed.'
