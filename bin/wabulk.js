#!/usr/bin/env node
/**
 * bin/wabulk.js — titik masuk CLI wabulk.
 *
 * Tugas file ini hanya tiga:
 * 1. Cek versi Node.js dan siapkan folder kerja.
 * 2. Serahkan kendali ke menu interaktif (src/ui.js).
 * 3. Tangani error & Ctrl+C dengan pesan yang ramah.
 */
import path from 'node:path';
import chalk from 'chalk';
import {
  AUTH_DIR,
  CONFIG_DIR,
  EXAMPLES_DIR,
  LOGS_DIR,
  NAMA_APP,
  NODE_MINIMAL,
  ROOT_DIR,
  VERSI_APP,
  cekVersiNode,
  isDibatalkan,
  pastikanFolder,
} from '../src/utils.js';

/** Hentikan aplikasi dengan pesan yang jelas. */
function keluarDenganPesan(pesan, kode = 1) {
  console.error('');
  console.error(chalk.red(`  ✖ ${pesan}`));
  console.error('');
  process.exit(kode);
}

// --- 1. Cek versi Node.js ---------------------------------------------------
const versi = cekVersiNode(NODE_MINIMAL);
if (!versi.ok) {
  console.error('');
  console.error(chalk.red(`  ✖ Node.js v${versi.minimal}+ dibutuhkan, versi Anda v${versi.versi}.`));
  console.error(chalk.gray('    Baileys 6.7.x dan library pendukungnya memerlukan Node.js 20 atau lebih baru.'));
  console.error('');
  console.error(chalk.gray('    Cara memperbarui:'));
  console.error(chalk.gray('      • Termux  : pkg install nodejs-lts'));
  console.error(chalk.gray('      • Linux/macOS: pasang Node.js LTS dari https://nodejs.org'));
  console.error(chalk.gray('      • nvm     : nvm install --lts && nvm use --lts'));
  console.error('');
  process.exit(1);
}

// --- 2. Siapkan folder kerja ------------------------------------------------
for (const folder of [CONFIG_DIR, AUTH_DIR, LOGS_DIR, EXAMPLES_DIR]) {
  const hasil = pastikanFolder(folder);
  if (hasil && hasil.error) {
    keluarDenganPesan(`Tidak bisa membuat folder ${path.relative(ROOT_DIR, folder)}: ${hasil.error.message}`);
  }
}

// --- 3. Tangani Ctrl+C (SIGINT) --------------------------------------------
let sedangKeluar = false;
process.on('SIGINT', () => {
  if (sedangKeluar) process.exit(130);
  sedangKeluar = true;
  console.log('');
  console.log(chalk.yellow(`  Menghentikan ${NAMA_APP} v${VERSI_APP}...`));
  console.log(chalk.gray('  Sampai jumpa! Session Anda tetap tersimpan di auth_info/.'));
  console.log('');
  process.exit(0);
});

/** Tangani error tak terduga agar tidak menampilkan stack trace mentah. */
function tanganiErrorTakTerduga(error) {
  if (isDibatalkan(error)) {
    console.log('');
    console.log(chalk.gray(`  ${NAMA_APP} dihentikan. Session tetap tersimpan.`));
    console.log('');
    process.exit(0);
  }
  console.error('');
  console.error(chalk.red(`  ✖ ${NAMA_APP} berhenti karena kesalahan: ${error?.message || error}`));
  if (error?.kode === 'ERR_MODULE_NOT_FOUND') {
    console.error(chalk.gray('    Dependency belum terpasang. Jalankan: bash install.sh'));
  }
  console.error(chalk.gray('    Jalankan ulang dengan `npm start`. Bila masih gagal, laporkan ke GitHub Issues.'));
  console.error('');
  process.exit(1);
}

process.on('uncaughtException', tanganiErrorTakTerduga);
process.on('unhandledRejection', tanganiErrorTakTerduga);

// --- 4. Jalankan aplikasi ---------------------------------------------------
try {
  const { mulaiAplikasi } = await import('../src/ui.js');
  const kode = await mulaiAplikasi();
  process.exit(Number.isInteger(kode) ? kode : 0);
} catch (error) {
  tanganiErrorTakTerduga(error);
}
