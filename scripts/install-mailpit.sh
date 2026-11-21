#!/usr/bin/env bash
# Downloads a pinned Mailpit release binary into ./.tools/mailpit (gitignored).
# Used locally and in CI so both environments run the same SMTP test server
# without requiring Docker or Homebrew.
set -euo pipefail

MAILPIT_VERSION="${MAILPIT_VERSION:-v1.34.0}"
INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)/.tools/mailpit"

if [[ -x "${INSTALL_DIR}/mailpit" ]]; then
  echo "Mailpit already installed: $("${INSTALL_DIR}/mailpit" version | head -1)"
  exit 0
fi

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) echo "Unsupported OS: $(uname -s). Use Docker: docker run -p 1025:1025 -p 8025:8025 axllent/mailpit" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch="amd64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

url="https://github.com/axllent/mailpit/releases/download/${MAILPIT_VERSION}/mailpit-${os}-${arch}.tar.gz"
mkdir -p "${INSTALL_DIR}"
echo "Downloading ${url}"
curl -fsSL "${url}" | tar -xz -C "${INSTALL_DIR}" mailpit
chmod +x "${INSTALL_DIR}/mailpit"
echo "Installed: $("${INSTALL_DIR}/mailpit" version | head -1)"
