#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# install.sh — pemasang otomatis wabulk
#
# Cara pakai:
#   bash install.sh              # install + daftarkan perintah `wabulk`
#   bash install.sh --tanpa-link # install saja (jalankan lewat `npm start`)
#   bash install.sh --bantu      # tampilkan bantuan
# ---------------------------------------------------------------------------
set -euo pipefail

TANPA_LINK=0
NODE_MINIMAL=20

# --- Warna (dimatikan bila output bukan terminal) ---------------------------
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  HIJAU="$(printf '\033[32m')"
  KUNING="$(printf '\033[33m')"
  MERAH="$(printf '\033[31m')"
  BIRU="$(printf '\033[36m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""; HIJAU=""; KUNING=""; MERAH=""; BIRU=""; RESET=""
fi

info()  { printf '%s\n' "${BIRU}ℹ${RESET} $*"; }
ok()    { printf '%s\n' "${HIJAU}✔${RESET} $*"; }
warn()  { printf '%s\n' "${KUNING}⚠${RESET} $*"; }

gagal() {
  printf '%s\n' "${MERAH}✖${RESET} $*" >&2
  exit 1
}

# --- Argumen ----------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --tanpa-link|--no-link) TANPA_LINK=1 ;;
    --bantu|--help|-h)
      sed -n '2,12p' "$0" | sed 's/^# *//'
      exit 0
      ;;
    *) warn "Argumen tidak dikenal: $arg (diabaikan)" ;;
  esac
done

# --- Pindah ke folder project ----------------------------------------------
cd "$(dirname "$0")"

printf '\n%s\n' "${BOLD}wabulk — pemasang${RESET}"
printf '%s\n\n' "CLI bulk pesan WhatsApp (Baileys). Untuk testing & pembelajaran."

# --- Deteksi platform -------------------------------------------------------
PLATFORM="Linux"
case "$(uname -s)" in
  Darwin) PLATFORM="macOS" ;;
  Linux)
    if [ -n "${PREFIX:-}" ] && printf '%s' "$PREFIX" | grep -qi 'com.termux'; then
      PLATFORM="Termux"
    elif [ -d /data/data/com.termux/files/usr ]; then
      PLATFORM="Termux"
    else
      PLATFORM="Linux"
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="Windows (Git Bash/WSL)" ;;
  *) PLATFORM="$(uname -s)" ;;
esac
info "Platform terdeteksi: ${BOLD}${PLATFORM}${RESET}"

if [ "${PLATFORM}" = "Termux" ] && ! command -v tmux >/dev/null 2>&1; then
  warn "tmux belum terpasang. Disarankan: pkg install tmux"
fi

# --- Cek Node.js & npm ------------------------------------------------------
command -v node >/dev/null 2>&1 || gagal "Node.js tidak ditemukan. Pasang dulu: https://nodejs.org (atau 'pkg install nodejs-lts' di Termux)."
command -v npm  >/dev/null 2>&1 || gagal "npm tidak ditemukan. npm biasanya ikut saat memasang Node.js."

VERSI_NODE="$(node -p 'process.versions.node')"
MAYOR_NODE="${VERSI_NODE%%.*}"

if [ "${MAYOR_NODE}" -lt "${NODE_MINIMAL}" ]; then
  warn "Node.js terdeteksi v${VERSI_NODE}, sedangkan Baileys 6.7.x butuh v${NODE_MINIMAL} atau lebih baru."
  if [ "${PLATFORM}" = "Termux" ]; then
    printf '  → Jalankan: pkg install nodejs-lts\n' >&2
  else
    printf '  → Pasang Node.js LTS terbaru dari https://nodejs.org\n' >&2
  fi
  gagal "Versi Node.js terlalu lama, instalasi dihentikan."
fi
ok "Node.js v${VERSI_NODE} dan npm $(npm -v) siap."

# --- Siapkan folder kerja ---------------------------------------------------
info "Menyiapkan folder config/, auth_info/, logs/, examples/ ..."
mkdir -p config auth_info logs examples
[ -f config/.gitkeep ]   || : > config/.gitkeep
[ -f auth_info/.gitkeep ] || : > auth_info/.gitkeep
[ -f logs/.gitkeep ]     || : > logs/.gitkeep
ok "Folder siap."

# --- Install dependency -----------------------------------------------------
info "Memasang dependency (mungkin butuh 1-2 menit)..."
if [ -f package-lock.json ]; then
  npm install --no-audit --no-fund || gagal "npm install gagal. Cek koneksi internet lalu ulangi."
else
  npm install --no-audit --no-fund || gagal "npm install gagal. Cek koneksi internet lalu ulangi."
fi
ok "Dependency terpasang."

# --- Cek sintaks (opsional, tidak menghentikan instalasi) -------------------
if npm run --silent check >/dev/null 2>&1; then
  ok "Pemeriksaan sintaks lolos."
else
  warn "Pemeriksaan sintaks melewati beberapa file (tidak fatal)."
fi

# --- Daftarkan perintah global ---------------------------------------------
if [ "${TANPA_LINK}" -eq 1 ]; then
  info "Melewati 'npm link' (mode --tanpa-link)."
else
  info "Mendaftarkan perintah 'wabulk' ..."
  if npm link >/dev/null 2>&1; then
    ok "Perintah 'wabulk' siap dipakai dari folder mana saja."
  else
    warn "'npm link' gagal (biasanya perlu izin folder global npm)."
    warn "Anda tetap bisa menjalankan wabulk lewat: npm start"
  fi
fi

# --- Penutup ----------------------------------------------------------------
printf '\n%s\n' "${BOLD}${HIJAU}Instalasi selesai!${RESET}"
printf '%s\n' "Jalankan salah satu perintah berikut:"
printf '  %s\n' "${BOLD}wabulk${RESET}       # bila npm link berhasil"
printf '  %s\n' "${BOLD}npm start${RESET}   # selalu bisa dipakai"
printf '\n%s\n\n' "${KUNING}Peringatan: penggunaan bulk WhatsApp via library tidak resmi melanggar Ketentuan Layanan WhatsApp dan berisiko nomor diblokir permanen. Gunakan nomor sekali pakai.${RESET}"
