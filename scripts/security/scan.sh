#!/usr/bin/env bash
set -euo pipefail
umask 077
mode="${1:-source}"
kit_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
report_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/security-reports.XXXXXXXX")"
trap 'rm -rf "$report_dir"' EXIT
# Raw diagnostics can contain source snippets. Keep them ephemeral; never cat or upload them.
run_check() {
  local label="$1"; shift
  if "$@" >"$report_dir/stdout" 2>"$report_dir/stderr"; then
    printf '%s: passed\n' "$label"
  else
    rc=$?
    printf '%s: blocked (exit %s). Review locally with the same pinned tool; raw findings were withheld.\n' "$label" "$rc"
    python "$kit_root/scripts/security/summarize-findings.py" "$report_dir"
    return "$rc"
  fi
}
export SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0
export SEMGREP_SETTINGS_FILE="$report_dir/semgrep-settings.yml" SEMGREP_LOG_FILE="$report_dir/semgrep.log"
export XDG_CONFIG_HOME="$report_dir/config" XDG_CACHE_HOME="$report_dir/cache"
export SYFT_CHECK_FOR_APP_UPDATE=false
unset SEMGREP_APP_TOKEN GITLEAKS_CONFIG GITLEAKS_CONFIG_TOML
gitleaks_flags=(--config "$kit_root/.security/gitleaks.toml" --gitleaks-ignore-path /dev/null --ignore-gitleaks-allow --timeout 300)
case "$mode" in
  source)
    # Full reachable history. Fetch depth must be zero. No baseline or automatic allowlist.
    run_check 'Secrets/history' gitleaks git "${gitleaks_flags[@]}" --redact=100 --no-banner --exit-code 1 --log-opts=--all --report-format json --report-path "$report_dir/gitleaks-history.json" .
    run_check 'Secrets/worktree' gitleaks dir "${gitleaks_flags[@]}" --redact=100 --no-banner --exit-code 1 --report-format json --report-path "$report_dir/gitleaks-tree.json" .
    run_check 'SAST' semgrep scan --oss-only --metrics=off --disable-version-check --disable-nosem --error --strict --jobs 2 --config "$kit_root/.security/semgrep.yml" --json --output "$report_dir/semgrep.json" .
    ;;
  bundle)
    shift
    [[ "$#" -gt 0 ]] || { echo 'At least one explicit artifact directory is required'; exit 2; }
    for artifact in "$@"; do
      [[ -d "$artifact" && ! -L "$artifact" ]] || { echo 'Artifact directory missing or symlinked'; exit 2; }
      [[ -n "$(find "$artifact" -type f -print -quit)" ]] || { echo 'Artifact directory empty'; exit 2; }
      # No ignore rules from the source tree: scan actual emitted JS, maps and public files.
      run_check 'Secrets/bundle' gitleaks dir "${gitleaks_flags[@]}" --redact=100 --no-banner --exit-code 1 --report-format json --report-path "$report_dir/gitleaks-bundle.json" "$artifact"
    done
    ;;
  *) echo 'Usage: scan.sh source | bundle DIR [DIR...]'; exit 2 ;;
esac
