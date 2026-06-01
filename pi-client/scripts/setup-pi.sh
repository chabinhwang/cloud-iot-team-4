#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_CLIENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_DIR="${PI_CLIENT_DIR}/.venv"
CURRENT_USER="${SUDO_USER:-${USER:-$(id -un)}}"

cd "${PI_CLIENT_DIR}"

echo "[setup] pi-client directory: ${PI_CLIENT_DIR}"
echo "[setup] This script does not create .env. Create/edit it yourself before running."

if command -v apt-get >/dev/null 2>&1; then
  echo "[setup] Installing Raspberry Pi system packages..."
  sudo apt-get update
  sudo apt-get install -y git python3-venv python3-pip libgpiod2
else
  echo "[setup] apt-get not found; skipping system package install."
fi

if getent group gpio >/dev/null 2>&1; then
  if id -nG "${CURRENT_USER}" | tr ' ' '\n' | grep -qx 'gpio'; then
    echo "[setup] User ${CURRENT_USER} is already in gpio group."
  else
    echo "[setup] Adding ${CURRENT_USER} to gpio group for DHT11 access..."
    sudo usermod -aG gpio "${CURRENT_USER}"
    echo "[setup] Reboot or log out/in after setup so gpio group membership applies."
  fi
else
  echo "[setup] gpio group not found; continuing."
fi

if [[ ! -d "${VENV_DIR}" ]]; then
  echo "[setup] Creating Python virtualenv at ${VENV_DIR}..."
  python3 -m venv "${VENV_DIR}"
fi

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
echo "[setup] Installing Python dependencies..."
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo "[setup] Done."
echo "[setup] Next: create ${PI_CLIENT_DIR}/.env, then run:"
echo "        ${PI_CLIENT_DIR}/scripts/run-pi-client.sh"
