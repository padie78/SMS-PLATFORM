#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# build-lambda.sh
# -----------------------------------------------------------------------------
# Construye el bundle Nx de un Lambda TS antes de que Terraform lo empaquete.
# Invocado por `data "external"` en `terraform/modules/compute/main.tf`.
#
# Protocolo `external`:
#   - Input  : JSON por stdin (no lo usamos).
#   - Output : JSON por stdout (única línea) cuando termina OK.
#   - Logs   : van a stderr (Terraform los pasa por su output).
#   - Exit   : 0 = OK, !=0 = error visible en plan.
#
# Args (posicionales pasados desde Terraform):
#   $1 = nombre del proyecto Nx (e.g. "api-lambda")
#   $2 = directorio absoluto donde debe quedar el bundle
#        (e.g. "${path.root}/../dist/lambda_code/api_lambda")
#
# Variables de entorno opcionales:
#   SMS_SKIP_LAMBDA_BUILD=1  → no compila, solo valida que el dist exista.
#                              Útil en CI cuando otro step ya hizo el build.
# -----------------------------------------------------------------------------
set -euo pipefail

# Stdin debe leerse aunque no lo usemos (Terraform pasa JSON).
read -r _stdin_unused || true

PROJECT_NAME="${1:?Falta arg #1: nombre del proyecto Nx}"
EXPECTED_DIR="${2:?Falta arg #2: directorio esperado del bundle}"

# Ubicarse en la raíz del repo (este script vive en terraform/scripts/).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${REPO_ROOT}"

if [[ "${SMS_SKIP_LAMBDA_BUILD:-0}" == "1" ]]; then
  echo "[build-lambda] SMS_SKIP_LAMBDA_BUILD=1 → skip build, valido dist..." >&2
  if [[ ! -d "${EXPECTED_DIR}" ]]; then
    echo "[build-lambda] ERROR: ${EXPECTED_DIR} no existe y se pidió skip." >&2
    exit 1
  fi
else
  echo "[build-lambda] nx run ${PROJECT_NAME}:build (daemon off)" >&2
  # NX_DAEMON=false → evita el daemon de Nx (watcher de FS) que puede crashear
  # cuando lo dispara un proceso no interactivo (Terraform, CI). La caché
  # local de Nx sigue funcionando, los rebuilds incrementales son rápidos.
  # CI=true → suprime prompts interactivos.
  if ! NX_DAEMON=false CI=true npx --yes nx run "${PROJECT_NAME}:build" 1>&2; then
    echo "[build-lambda] ERROR: nx build ${PROJECT_NAME} falló." >&2
    exit 1
  fi
fi

if [[ ! -f "${EXPECTED_DIR}/main.js" ]]; then
  echo "[build-lambda] ERROR: bundle ${EXPECTED_DIR}/main.js no se generó." >&2
  exit 1
fi

# JSON de salida obligatorio para el provider external.
BUNDLE_HASH="$(sha256sum "${EXPECTED_DIR}/main.js" | awk '{print $1}')"
printf '{"status":"ok","project":"%s","bundle_dir":"%s","bundle_sha256":"%s"}\n' \
  "${PROJECT_NAME}" "${EXPECTED_DIR}" "${BUNDLE_HASH}"
