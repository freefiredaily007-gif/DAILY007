#!/usr/bin/env bash
# android-emulator-runner runs each script input line in a separate shell.
# Invoke this file in one line so variables, functions, traps and Metro persist.
set -euo pipefail

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
cleanup() {
  local status=$?
  printf 'exit_status=%s\n' "$status" > "$DIAG_DIR/runner-exit.txt"
  adb logcat -d -t 2000 > "$DIAG_DIR/android-logcat.txt" 2>&1 || true
  if [ -n "$METRO_PID" ]; then
    kill "$METRO_PID" 2>/dev/null || true
    wait "$METRO_PID" 2>/dev/null || true
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

run_logged expo-go-install adb install -r "$RUNNER_TEMP_DIR/expo-go.apk"
run_logged expo-go-package-path adb shell pm path host.exp.exponent
run_logged adb-reverse adb reverse tcp:8081 tcp:8081

EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1 \
EXPO_PUBLIC_DOMAIN=daily007-ci.invalid \
EXPO_NO_TELEMETRY=1 \
CI=1 \
  pnpm --filter @workspace/daily007 exec expo start \
    --go --localhost --port 8081 > "$DIAG_DIR/daily007-metro.log" 2>&1 &
METRO_PID=$!

metro_ready=false
for attempt in $(seq 1 90); do
  if curl --fail --silent http://127.0.0.1:8081/status > "$DIAG_DIR/metro-status.txt" &&
    grep -q "packager-status:running" "$DIAG_DIR/metro-status.txt"; then
    metro_ready=true
    break
  fi
  if ! kill -0 "$METRO_PID" 2>/dev/null; then break; fi
  sleep 2
done
if [ "$metro_ready" != true ]; then
  cat "$DIAG_DIR/daily007-metro.log"
  echo "Android API level ${ANDROID_API_LEVEL}: Metro did not become ready on port 8081." >&2
  exit 1
fi
cat "$DIAG_DIR/metro-status.txt"

# Query from Android through adb reverse, not only from the host.
run_logged emulator-metro-status adb shell \
  'printf "GET /status HTTP/1.0\r\nHost: localhost\r\n\r\n" | toybox nc -w 5 127.0.0.1 8081'
grep -q "packager-status:running" "$DIAG_DIR/emulator-metro-status.log"
printf 'Expo Go installed; host and emulator both reached packager-status:running.\n' \
  > "$DIAG_DIR/setup-verified.txt"
echo "::notice::Android API ${ANDROID_API_LEVEL}: Expo Go installed; Metro reachable from host and emulator."
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '### Android API %s setup\n- Expo Go installed successfully.\n- Host and emulator reached `packager-status:running`.\n' \
    "$ANDROID_API_LEVEL" >> "$GITHUB_STEP_SUMMARY"
fi

run_maestro_suite() {
  local suite_name="$1"
  local package_script="$2"
  local suite_log="$DIAG_DIR/maestro-${suite_name}.log"
  local suite_status
  echo "Running Android API level ${ANDROID_API_LEVEL} Maestro suite: ${suite_name}"
  if EXPO_DEV_URL=exp://127.0.0.1:8081 \
    pnpm --filter @workspace/daily007 run "$package_script" > "$suite_log" 2>&1; then
    cat "$suite_log"
  else
    suite_status=$?
    cat "$suite_log"
    echo "Android API level ${ANDROID_API_LEVEL} Maestro suite ${suite_name} failed with exit code ${suite_status}." >&2
    return "$suite_status"
  fi
}

if [ "$ANDROID_API_LEVEL" = 36 ]; then
  run_maestro_suite join-form-accessibility test:android-join-form-accessibility
else
  run_maestro_suite join-recovery test:android-join-recovery
  run_maestro_suite join-form-accessibility test:android-join-form-accessibility
  run_maestro_suite home-match-back test:android-home-match-back
  run_maestro_suite wallet-cancellation test:android-wallet-cancellation-refund
  run_maestro_suite wallet-cancellation-narrow-large-text test:android-wallet-cancellation-refund-large-text
  run_maestro_suite leaderboard-large-text test:android-leaderboard-large-text
  run_maestro_suite leaderboard-tabs test:android-leaderboard-tabs
  run_maestro_suite session-verification test:android-session-verification
  run_maestro_suite withdrawal-upi-copy test:android-withdrawal-upi-copy
fi
