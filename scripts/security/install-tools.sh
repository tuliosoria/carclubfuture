#!/usr/bin/env bash
set -euo pipefail
# Linux x86_64 only. Official release assets; never pipe remote code into a shell.
test "$(uname -s)/$(uname -m)" = Linux/x86_64
root="${RUNNER_TEMP:-/tmp}/security-tools"
mkdir -p "$root/bin"
fetch() {
  local url="$1" digest="$2" binary="$3"
  local archive="$root/$binary.tar.gz"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$url" -o "$archive"
  printf '%s  %s\n' "$digest" "$archive" | sha256sum --check --status
  tar -xzf "$archive" -C "$root/bin" "$binary"
}
fetch https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb gitleaks
fetch https://github.com/anchore/syft/releases/download/v1.57.1/syft_1.57.1_linux_amd64.tar.gz bf52519eb57f675d47c07d43213cb6dff6449f3d6d1147ff6701ed91f44eef0c syft
python -m venv "$root/venv"
# Lock generated for CPython 3.12; refuse source builds and verify all dependency hashes.
"$root/venv/bin/python" -m pip --isolated --disable-pip-version-check install --index-url https://pypi.org/simple --only-binary=:all: --require-hashes -r .security/requirements-linux-py312.txt
if [[ -n "${GITHUB_PATH:-}" ]]; then
  printf '%s\n' "$root/bin" "$root/venv/bin" >> "$GITHUB_PATH"
fi
