#!/usr/bin/env bash
set -u

API_LEVEL="${1:-}"
EMULATOR_PORT="${2:-5554}"
case "$API_LEVEL" in
  35|36) ;;
  *) echo "Unsupported Android API level: $API_LEVEL" >&2; exit 2 ;;
esac
case "$EMULATOR_PORT" in
  ''|*[!0-9]*) echo "Invalid emulator port." >&2; exit 2 ;;
esac

WORKSPACE_DIR="${GITHUB_WORKSPACE:-$PWD}"
ROOT_DIAG_DIR="$WORKSPACE_DIR/android-emulator-diagnostics"
if [ "$API_LEVEL" = 36 ]; then
  RUNNER_MARKER="$ROOT_DIAG_DIR/api-36/runner-started.txt"
else
  RUNNER_MARKER="$ROOT_DIAG_DIR/runner-started.txt"
fi

# Runner-level diagnostics are more useful once the test script has started.
# Keep setup-only logs out of runs that failed later in the test script.
if [ -f "$RUNNER_MARKER" ]; then
  echo "Android API $API_LEVEL test script started; skipping setup-only diagnostics."
  exit 0
fi

DIAG_DIR="$ROOT_DIAG_DIR/api-${API_LEVEL}-setup"
mkdir -p "$DIAG_DIR"
{
  printf 'Emulator setup failed before the test script started.\n'
  printf 'api_level=%s\nemulator_port=%s\n' "$API_LEVEL" "$EMULATOR_PORT"
  printf 'The original emulator action error remains in the workflow log; these files are supplemental.\n'
  printf 'No environment variables or application configuration files were collected.\n'
} > "$DIAG_DIR/setup-context.txt"

capture() {
  local name="$1"
  shift
  local output_file="$DIAG_DIR/${name}.txt"
  local status=0
  local command_timeout_seconds="${ANDROID_DIAGNOSTICS_COMMAND_TIMEOUT_SECONDS:-10}"

  if ! [[ "$command_timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
    echo "Invalid Android diagnostics command timeout." >&2
    return 2
  fi

  # Redact before writing to the artifact directory, so raw output is never
  # uploaded even if a later command fails.
  timeout --signal=TERM --kill-after=2s "${command_timeout_seconds}s" "$@" 2>&1 |
    sed -E \
      -e 's/([Bb]earer[[:space:]]+)[A-Za-z0-9._~+\/=-]+/\1[REDACTED]/g' \
      -e 's/((token|secret|password|authorization|api[_-]?key)[[:space:]\"'\'']*[:=][[:space:]\"'\'']*)[^[:space:],;\"'\'']+/\1[REDACTED]/Ig' \
      > "$output_file"
  status="${PIPESTATUS[0]}"
  { printf 'exit_status=%s\n' "$status"; cat "$output_file"; } > "$output_file.tmp"
  mv "$output_file.tmp" "$output_file"
}

capture host-platform uname -a
capture disk-space df -h "$WORKSPACE_DIR" "${ANDROID_HOME:-$WORKSPACE_DIR}"
capture kvm-device bash -c 'if [ -e /dev/kvm ]; then ls -l /dev/kvm; else echo "/dev/kvm is missing"; exit 1; fi'
capture emulator-version emulator -version
capture emulator-avds emulator -list-avds
capture sdk-packages bash -c \
  "sdkmanager --list_installed | grep -E '^(emulator|platform-tools|platforms;android-${API_LEVEL}|system-images;android-${API_LEVEL};google_apis;x86_64)'"
capture adb-version adb version
capture adb-devices adb devices -l
capture emulator-state adb -s "emulator-${EMULATOR_PORT}" get-state
capture emulator-boot-properties adb -s "emulator-${EMULATOR_PORT}" shell \
  'getprop sys.boot_completed; getprop ro.build.version.sdk'
capture emulator-boot-logcat adb -s "emulator-${EMULATOR_PORT}" logcat \
  -b all -d -v threadtime -t 3000

echo "Saved supplemental Android API $API_LEVEL setup diagnostics to $DIAG_DIR."
