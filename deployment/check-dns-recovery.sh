#!/bin/sh
set -eu

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
project_name="composelens-dns-check-$$"
test_port="${DNS_TEST_PORT:-18080}"
base_url="http://127.0.0.1:$test_port"

# Use a separate project so the check never stops the main application stack.
compose() {
    PORT="$test_port" docker compose --project-name "$project_name" \
        -f "$script_dir/compose.yml" "$@"
}

cleanup() {
    result=$?
    if [ "$result" -ne 0 ]; then
        compose logs --no-color >&2 || true
    fi
    compose down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

wait_for_api() {
    attempt=0
    while [ "$attempt" -lt 20 ]; do
        status="$(curl --silent --show-error --max-time 3 -o /dev/null \
            -w '%{http_code}' "$base_url/api/images")"
        if [ "$status" = 400 ]; then
            return
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
    echo 'Backend DNS did not recover within the expected resolver window.' >&2
    return 1
}

# backend has no network endpoint yet: nginx must still start and serve the SPA.
compose up --detach --no-deps --wait --wait-timeout 60 web
web_id="$(compose ps -q web)"
web_started_at="$(docker inspect --format '{{.State.StartedAt}}' "$web_id")"
curl --fail --silent --show-error --max-time 5 "$base_url/healthz" >/dev/null
status="$(curl --silent --show-error --max-time 5 -o /dev/null -w '%{http_code}' "$base_url/api/images")"
test "$status" = 502

compose up --detach --no-deps --wait --wait-timeout 60 backend
wait_for_api
sh "$script_dir/smoke-test.sh" "$base_url"

compose up --detach --force-recreate --no-deps --wait --wait-timeout 60 backend
wait_for_api
test "$(compose ps -q web)" = "$web_id"
test "$(docker inspect --format '{{.State.StartedAt}}' "$web_id")" = "$web_started_at"
sh "$script_dir/smoke-test.sh" "$base_url"

echo 'Nginx survived missing backend DNS and recovered after backend recreation.'
