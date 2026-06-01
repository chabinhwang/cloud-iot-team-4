#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_CLIENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_PYTHON="${PI_CLIENT_DIR}/.venv/bin/python"
ENV_FILE="${PI_CLIENT_DIR}/.env"

cd "${PI_CLIENT_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[run] Missing .env: ${ENV_FILE}" >&2
  echo "[run] Create it yourself, for example:" >&2
  echo "      cd ${PI_CLIENT_DIR}" >&2
  echo "      cp .env.example .env" >&2
  echo "      nano .env" >&2
  exit 1
fi

if [[ ! -x "${VENV_PYTHON}" ]]; then
  echo "[run] Missing virtualenv Python: ${VENV_PYTHON}" >&2
  echo "[run] Run setup first:" >&2
  echo "      ${PI_CLIENT_DIR}/scripts/setup-pi.sh" >&2
  exit 1
fi

echo "[run] Starting pi-client. Press Ctrl+C to stop."
echo "[run] Using env file: ${ENV_FILE}"
exec "${VENV_PYTHON}" -m src.main
