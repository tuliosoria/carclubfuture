#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$#" == 2 && -d "$1" ]] || { echo 'Usage: sbom.sh INPUT_DIRECTORY OUTPUT_JSON'; exit 2; }
# Caller chooses a private output outside the tree being catalogued.
export SYFT_CHECK_FOR_APP_UPDATE=false
log="$(mktemp "${RUNNER_TEMP:-/tmp}/syft-log.XXXXXXXX")"
trap 'rm -f "$log"' EXIT
if ! syft "dir:$1" -o "cyclonedx-json=$2" >"$log" 2>&1; then
  echo 'SBOM generation failed; raw diagnostics withheld'; exit 1
fi
python - "$2" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))
assert p.get('bomFormat') == 'CycloneDX'
assert isinstance(p.get('components'),list) and p['components'], 'Empty SBOM needs investigation'
print('SBOM generated and format checked; not uploaded')
PY
