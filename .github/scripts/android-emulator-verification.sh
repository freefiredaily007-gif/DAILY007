#!/usr/bin/env bash
# android-emulator-runner runs each script input line in a separate shell.
# Invoke this file in one line so variables, functions, traps and Metro persist.
set -Eeuo pipefail

export ANDROID_API_LEVEL="${1:?Expected Android API level 35 or 36}"
case "$ANDROID_API_LEVEL" in
  35|36) ;;
  *) echo "Unsupported Android API level: $ANDROID_API_LEVEL" >&2; exit 2 ;;
esac

WORKSPACE_DIR="${GITHUB_WORKSPACE:-$PWD}"
RUNNER_TEMP_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
DIAG_DIR="$WORKSPACE_DIR/android-emulator-diagnostics"
if [ "$ANDROID_API_LEVEL" = 36 ]; then DIAG_DIR="$DIAG_DIR/api-36"; fi
export MAESTRO_TEST_OUTPUT_DIR="$DIAG_DIR/maestro-output"
mkdir -p "$MAESTRO_TEST_OUTPUT_DIR"
printf 'Emulator script started. api=%s cwd=%s workspace=%s\n' \
  "$ANDROID_API_LEVEL" "$PWD" "$WORKSPACE_DIR" > "$DIAG_DIR/runner-started.txt"
METRO_PID=""
OAUTH_FIXTURE_PID=""
PHASE="initialize"
FAILURE_REPORTED=0
report_failure() {
  local status="$1"
  local line="$2"
  local details="${3:-}"
  [ "$FAILURE_REPORTED" = 1 ] && return 0
  FAILURE_REPORTED=1
  printf 'phase=%s\nexit_status=%s\nscript_line=%s\ndetails=%s\n' \
    "$PHASE" "$status" "$line" "$details" > "$DIAG_DIR/failure-details.txt"
  echo "::error title=Android API ${ANDROID_API_LEVEL} emulator failure::Phase '${PHASE}' failed at script line ${line} (exit ${status}). ${details}"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '\n### Android API %s emulator failure\n- Phase: `%s`\n- Script line: %s\n- Exit code: %s\n- Details: %s\n' \
      "$ANDROID_API_LEVEL" "$PHASE" "$line" "$status" "$details" >> "$GITHUB_STEP_SUMMARY"
  fi
}
trap 'report_failure "$?" "$LINENO"' ERR
cleanup() {
  local status=$?
  printf 'exit_status=%s\n' "$status" > "$DIAG_DIR/runner-exit.txt"
  adb logcat -d -t 2000 > "$DIAG_DIR/android-logcat.txt" 2>&1 || true
  if [ -n "$METRO_PID" ]; then
    kill "$METRO_PID" 2>/dev/null || true
    wait "$METRO_PID" 2>/dev/null || true
  fi
  if [ -n "$OAUTH_FIXTURE_PID" ]; then
    kill "$OAUTH_FIXTURE_PID" 2>/dev/null || true
    wait "$OAUTH_FIXTURE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

run_logged() {
  local command_name="$1"
  shift
  local command_log="$DIAG_DIR/${command_name}.log"
  local command_status
  if "$@" > "$command_log" 2>&1; then
    cat "$command_log"
  else
    command_status=$?
    cat "$command_log"
    echo "Android API level ${ANDROID_API_LEVEL} command ${command_name} failed with exit code ${command_status}." >&2
    return "$command_status"
  fi
}

PHASE="install Expo Go APK"
run_logged expo-go-install adb install -r "$RUNNER_TEMP_DIR/expo-go.apk"
PHASE="verify Expo Go package installation"
run_logged expo-go-package-path adb shell pm path host.exp.exponent

PHASE="select an available Metro port"
METRO_PORT="$(node -e '
  const server = require("node:net").createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => process.stdout.write(String(port)));
  });
')"
case "$METRO_PORT" in
  ''|*[!0-9]*) echo "Could not select a valid Metro port: $METRO_PORT" >&2; exit 1 ;;
esac
export METRO_PORT

PHASE="start local Google OAuth callback fixture"
OAUTH_FIXTURE_PORT=""
if [ "$ANDROID_API_LEVEL" = 35 ]; then
  OAUTH_FIXTURE_PORT="$(node -e '
    const server = require("node:net").createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => process.stdout.write(String(port)));
    });
  ')"
  case "$OAUTH_FIXTURE_PORT" in
    ''|*[!0-9]*) echo "Could not select a valid OAuth fixture port: $OAUTH_FIXTURE_PORT" >&2; exit 1 ;;
  esac
  export GOOGLE_LINK_OAUTH_FIXTURE_PORT="$OAUTH_FIXTURE_PORT"
  export EXPO_PUBLIC_GOOGLE_LINK_TEST_AUTH_URL="http://127.0.0.1:${OAUTH_FIXTURE_PORT}/auth"
fi

PHASE="configure adb reverse for Metro port ${METRO_PORT}"
run_logged adb-reverse adb reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}"

PHASE="start Expo Metro on host port ${METRO_PORT}"
EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1 \
EXPO_PUBLIC_DOMAIN=daily007-ci.invalid \
EXPO_NO_TELEMETRY=1 \
NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first --require=${WORKSPACE_DIR}/.github/scripts/disable-rn-devtools-shell.cjs" \
CI=1 \
  pnpm --filter @workspace/daily007 exec expo start \
    --go --localhost --port "$METRO_PORT" > "$DIAG_DIR/daily007-metro.log" 2>&1 &
METRO_PID=$!

metro_ready=false
PHASE="wait for Metro host status on port ${METRO_PORT}"
for attempt in $(seq 1 90); do
  if curl --noproxy '*' --fail --silent "http://localhost:${METRO_PORT}/status" > "$DIAG_DIR/metro-status.txt" &&
    grep -q "packager-status:running" "$DIAG_DIR/metro-status.txt"; then
    metro_ready=true
    break
  fi
  if ! kill -0 "$METRO_PID" 2>/dev/null; then break; fi
  sleep 2
done
if [ "$metro_ready" != true ]; then
  cat "$DIAG_DIR/daily007-metro.log"
  {
    echo "Node localhost resolution:"
    node -e 'require("node:dns").lookup("localhost", { all: true }, (error, addresses) => console.log(JSON.stringify({ error, addresses })))' || true
    echo "TCP listeners for Metro port ${METRO_PORT}:"
    if command -v ss >/dev/null 2>&1; then
      ss -ltnp 2>&1 | grep -E "(^State|:${METRO_PORT}([[:space:]]|$))" || true
    else
      echo "ss is not installed"
    fi
    for probe_host in localhost 127.0.0.1; do
      echo "HTTP ${probe_host} probe:"
      curl --noproxy '*' --connect-timeout 2 --max-time 4 --silent --show-error --include \
        "http://${probe_host}:${METRO_PORT}/status" || true
    done
    echo "Expo process:"
    ps -p "$METRO_PID" -o pid,ppid,stat,etime,args 2>&1 || true
  } > "$DIAG_DIR/metro-host-diagnostics.txt" 2>&1
  cat "$DIAG_DIR/metro-host-diagnostics.txt"
  PHASE="Metro did not become ready on host port ${METRO_PORT}"
  metro_details="$(tail -n 12 "$DIAG_DIR/daily007-metro.log" 2>/dev/null | tr '\n' ' ' | cut -c1-700)"
  report_failure 1 "$LINENO" "$metro_details"
  exit 1
fi
cat "$DIAG_DIR/metro-status.txt"

printf 'Expo Go installed; host Metro reached packager-status:running and adb reverse was configured on port %s. Maestro flows verify app connectivity.\n' "$METRO_PORT" \
  > "$DIAG_DIR/host-ready.txt"
echo "::notice::Android API ${ANDROID_API_LEVEL}: Expo Go installed; host Metro ready and adb reverse configured on port ${METRO_PORT}. Maestro will verify app connectivity."
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '### Android API %s setup\n- Expo Go installed successfully.\n- Host Metro reached `packager-status:running` on port %s.\n- ADB reverse configured; Maestro flows will verify app connectivity.\n' \
    "$ANDROID_API_LEVEL" "$METRO_PORT" >> "$GITHUB_STEP_SUMMARY"
fi

if [ "$ANDROID_API_LEVEL" = 35 ]; then
  PHASE="start local Google OAuth callback fixture"
  node artifacts/daily007/scripts/google-link-native-oauth-fixture-server.mjs \
    > "$DIAG_DIR/google-link-oauth-fixture.log" 2>&1 &
  OAUTH_FIXTURE_PID=$!
  oauth_fixture_ready=false
  for attempt in $(seq 1 30); do
    if curl --fail --silent "http://127.0.0.1:${OAUTH_FIXTURE_PORT}/health" > "$DIAG_DIR/google-link-oauth-fixture-health.txt"; then
      oauth_fixture_ready=true
      break
    fi
    if ! kill -0 "$OAUTH_FIXTURE_PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if [ "$oauth_fixture_ready" != true ]; then
    cat "$DIAG_DIR/google-link-oauth-fixture.log"
    PHASE="local Google OAuth callback fixture did not become ready"
    report_failure 1 "$LINENO" "fixture port ${OAUTH_FIXTURE_PORT}"
    exit 1
  fi
  run_logged oauth-fixture-adb-reverse adb reverse "tcp:${OAUTH_FIXTURE_PORT}" "tcp:${OAUTH_FIXTURE_PORT}"
fi

run_maestro_suite() {
  local suite_name="$1"
  local package_script="$2"
  local suite_log="$DIAG_DIR/maestro-${suite_name}.log"
  local suite_status
  local reverse_mappings
  local suite_details
  local result_files
  local result_diagnostics
  local metro_diagnostics
  local device_diagnostics
  local screen_text
  local screen_diagnostics
  PHASE="Maestro suite ${suite_name}"
  echo "Running Android API level ${ANDROID_API_LEVEL} Maestro suite: ${suite_name}"
  if EXPO_DEV_URL="exp://127.0.0.1:${METRO_PORT}" \
    pnpm --filter @workspace/daily007 run "$package_script" > "$suite_log" 2>&1; then
    cat "$suite_log"
  else
    suite_status=$?
    cat "$suite_log"
    reverse_mappings="$(adb reverse --list 2>&1 | tr '\r\n' ' ' | cut -c 1-400)"
    [ -n "$reverse_mappings" ] || reverse_mappings="<no reverse mappings>"
    suite_details="$(tail -n 20 "$suite_log" | tr '\r\n' ' ' | cut -c 1-800)"
    [ -n "$suite_details" ] || suite_details="<empty Maestro output>"
    result_files="$(find "$MAESTRO_TEST_OUTPUT_DIR" -type f -printf '%P ' 2>/dev/null | tr '\r\n' ' ' | cut -c 1-400 || true)"
    [ -n "$result_files" ] || result_files="<no test output files>"
    result_diagnostics="$(
      find "$MAESTRO_TEST_OUTPUT_DIR" -type f -path '*/logs/maestro.log' -print0 2>/dev/null |
        while IFS= read -r -d '' report; do
          printf '%s: ' "${report#"$MAESTRO_TEST_OUTPUT_DIR"/}"
          tail -n 12 "$report" | tr '\r\n' ' '
          printf '; '
        done | cut -c 1-1200
    )"
    [ -n "$result_diagnostics" ] || result_diagnostics="<no Maestro per-flow logs>"
    metro_diagnostics="$(tail -n 30 "$DIAG_DIR/daily007-metro.log" 2>/dev/null | tr '\r\n' ' ' | cut -c1-1200 || true)"
    [ -n "$metro_diagnostics" ] || metro_diagnostics="<no Metro log output>"
    device_diagnostics="$(
      find "$MAESTRO_TEST_OUTPUT_DIR" -type f -path '*/logs/device-logcat.txt' -print0 2>/dev/null |
        while IFS= read -r -d '' report; do
          matching_errors="$(grep -Ei 'FATAL EXCEPTION|AndroidRuntime|ReactNativeJS.*(Error|Exception|Failed|Unable)|Unhandled JS|Unable to load script|Failed to load bundle|Could not connect' "$report" 2>/dev/null |
            tail -n 12 | tr '\r\n' ' ' | cut -c 1-600 || true)"
          if [ -n "$matching_errors" ]; then
            printf '%s: %s; ' "${report#"$MAESTRO_TEST_OUTPUT_DIR"/}" "$matching_errors"
          fi
        done | cut -c 1-1200
    )"
    [ -n "$device_diagnostics" ] || device_diagnostics="<no matching runtime errors>"
    screen_diagnostics="$(
      find "$MAESTRO_TEST_OUTPUT_DIR" -type f -path '*/screen-hierarchy/*' -print0 2>/dev/null |
        while IFS= read -r -d '' screen; do
          printf '%s: ' "${screen#"$MAESTRO_TEST_OUTPUT_DIR"/}"
          if [[ "$screen" == *.json ]]; then
            screen_text="$(node "$(dirname "${BASH_SOURCE[0]}")/maestro-screen-hierarchy-text.mjs" "$screen" 2>/dev/null | cut -c 1-500 || true)"
          else
            screen_text="$(grep -oE '(text|content-desc)="[^"]+"' "$screen" 2>/dev/null |
              grep -vE '=""' | tr '\r\n' ' ' | cut -c 1-500 || true)"
          fi
          printf '%s' "${screen_text:-<no screen text extracted>}"
          printf '; '
        done | cut -c 1-1200
    )"
    [ -n "$screen_diagnostics" ] || screen_diagnostics="<no screen-hierarchy text>"
    echo "Android API level ${ANDROID_API_LEVEL} Maestro suite ${suite_name} failed with exit code ${suite_status}." >&2
    report_failure "$suite_status" "$LINENO" \
      "Maestro output: ${suite_details}; Metro log tail: ${metro_diagnostics}; device runtime errors: ${device_diagnostics}; test output files: ${result_files}; Maestro logs: ${result_diagnostics}; screen text: ${screen_diagnostics}; ADB reverse mappings: ${reverse_mappings}."
    return "$suite_status"
  fi
}

configure_maestro_flow_environment() {
  local maestro_binary
  local wrapper_dir="$RUNNER_TEMP_DIR/daily007-maestro-wrapper"
  maestro_binary="$(command -v maestro)"
  mkdir -p "$wrapper_dir"
  cat > "$wrapper_dir/maestro" <<'MAESTRO_WRAPPER'
#!/usr/bin/env bash
set -Eeuo pipefail
if [ "${1:-}" = test ] && [ -n "${EXPO_DEV_URL:-}" ]; then
  shift
  for argument in "$@"; do
    if [[ "$argument" == EXPO_DEV_URL=* ]]; then
      exec "${MAESTRO_REAL_BIN:?MAESTRO_REAL_BIN is required}" test "$@"
    fi
  done
  exec "${MAESTRO_REAL_BIN:?MAESTRO_REAL_BIN is required}" test -e "EXPO_DEV_URL=${EXPO_DEV_URL}" "$@"
fi
exec "${MAESTRO_REAL_BIN:?MAESTRO_REAL_BIN is required}" "$@"
MAESTRO_WRAPPER
  chmod +x "$wrapper_dir/maestro"
  export MAESTRO_REAL_BIN="$maestro_binary"
  export PATH="$wrapper_dir:$PATH"
}

PHASE="configure Maestro Expo URL forwarding"
configure_maestro_flow_environment

if [ "$ANDROID_API_LEVEL" = 36 ]; then
  run_maestro_suite join-form-accessibility test:android-join-form-accessibility
  run_maestro_suite tournament-pull-refresh test:android-tournament-pull-refresh
else
  run_maestro_suite join-recovery test:android-join-recovery
  run_maestro_suite join-form-accessibility test:android-join-form-accessibility
  run_maestro_suite home-match-back test:android-home-match-back
  run_maestro_suite wallet-cancellation test:android-wallet-cancellation-refund
  run_maestro_suite wallet-admin-credit-refund test:android-wallet-admin-credit-refund
  run_maestro_suite wallet-payment-history test:android-wallet-payment-history
  run_maestro_suite wallet-cancellation-narrow-large-text test:android-wallet-cancellation-refund-large-text
  run_maestro_suite player-large-text test:android-player-large-text
  run_maestro_suite leaderboard-large-text test:android-leaderboard-large-text
  run_maestro_suite leaderboard-tabs test:android-leaderboard-tabs
  run_maestro_suite session-verification test:android-session-verification
  run_maestro_suite google-link-native-retry test:android-google-link-retry
  run_maestro_suite clerk-logout test:android-logout
  run_maestro_suite withdrawal-upi-copy test:android-withdrawal-upi-copy
fi
