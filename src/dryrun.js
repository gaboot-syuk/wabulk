/**
 * dryrun.js — validasi nomor via `onWhatsApp` tanpa mengirim pesan.
 *
 * Dipakai oleh:
 * - menu "Mode Dry Run" (hanya memeriksa nomor lalu simpan hasil)
 * - sender, saat pengaturan `dryRun: true` (memeriksa dulu sebelum kirim)
 */
import chalk from 'chalk';
import ora from 'ora';
import { cekSinyal, delay, formatDurasi, isJidGrup, potong } from './utils.js';
import { simpanLog } from './logger.js';

/** Jeda antar permintaan validasi (ms) — hindari terlalu cepat ke server. */
export const JEDA_ANTAR_CEK_MS = 1500;

/** Jumlah nomor yang ditampilkan di laporan ringkas. */
export const MAKS_TAMPIL_LAPORAN = 15;

/**
 * Validasi daftar nomor.
 * @param {object} sock socket Baileys yang sudah terbuka
 * @param {Array<{nomor: string, nama?: string, jid: string, adalahGrup?: boolean}>} daftar
 * @param {{onProgress?: Function, jedaMs?: number, sinyal?: object}} opsi
 * @returns {Promise<{total: number, valid: Array, tidakValid: Array, grup: Array, siapKirim: Array, durasiMs: number, durasi: string, waktu: string}>}
 */
export async function validasiDaftar(sock, daftar, opsi = {}) {
  const { onProgress = null, jedaMs = JEDA_ANTAR_CEK_MS, sinyal = null } = opsi;

  if (!sock) throw new Error('Belum tersambung ke WhatsApp.');
  const total = Array.isArray(daftar) ? daftar.length : 0;
  if (total === 0) {
    return { total: 0, valid: [], tidakValid: [], grup: [], siapKirim: [], durasiMs: 0, durasi: '0d', waktu: new Date().toISOString() };
  }

  const mulai = Date.now();
  const valid = [];
  const tidakValid = [];
  const grup = [];

  for (let index = 0; index < total; index += 1) {
    cekSinyal(sinyal);
    const item = daftar[index];

    if (onProgress) onProgress({ index: index + 1, total, item });

    // JID grup tidak perlu validasi — anggap langsung valid.
    if (item.adalahGrup || isJidGrup(item.jid)) {
      const entri = { nomor: item.nomor, nama: item.nama || '', jid: item.jid };
      grup.push(entri);
      if (index < total - 1) await delay(jedaMs);
      continue;
    }

    try {
      const hasil = await sock.onWhatsApp(item.jid);
      const ada = Array.isArray(hasil) ? hasil.find((h) => h && h.exists) : null;
      if (ada) {
        // Penting: tetap pakai JID asli (nomor telepon / grup) sebagai tujuan
        // kirim. Sebagian versi WhatsApp mengembalikan JID `@lid` di sini, dan
        // mengirim ke `@lid` bisa membuat penerima tertahan di pesan
        // "Menunggu pesan ini". LID hanya disimpan sebagai metadata.
        valid.push({
          nomor: item.nomor,
          nama: item.nama || '',
          jid: item.jid,
          lid: ada.lid || null,
        });
      } else {
        tidakValid.push({
          nomor: item.nomor,
          nama: item.nama || '',
          jid: item.jid,
          alasan: 'Nomor tidak terdaftar di WhatsApp',
        });
      }
    } catch (error) {
      tidakValid.push({
        nomor: item.nomor,
        nama: item.nama || '',
        jid: item.jid,
        alasan: `Gagal memeriksa: ${error.message}`,
      });
    }

    if (index < total - 1) await delay(jedaMs);
  }

  const durasiMs = Date.now() - mulai;
  return {
    total,
    valid,
    tidakValid,
    grup,
    siapKirim: [...valid, ...grup],
    durasiMs,
    durasi: formatDurasi(durasiMs),
    waktu: new Date().toISOString(),
  };
}

/**
 * Versi validasi dengan progress bar (ora) — dipakai dari menu interaktif.
 */
export async function validasiDenganProgress(sock, daftar, opsi = {}) {
  const spinner = opsi.cetakProgres === false ? spinnerSenyap() : ora();
  spinner.start(`Memeriksa 0/${daftar.length} nomor...`);

  try {
    const hasil = await validasiDaftar(sock, daftar, {
      ...opsi,
      onProgress: ({ index, total, item }) => {
        spinner.text = `Memeriksa ${index}/${total} → ${potong(item.nomor || item.jid, 22)}`;
        if (typeof opsi.onProgress === 'function') opsi.onProgress({ index, total, item });
      },
    });

    const ringkas =
      `${hasil.total} nomor diperiksa • ` +
      `${chalk.green(`${hasil.valid.length} valid`)} • ` +
      `${chalk.red(`${hasil.tidakValid.length} tidak valid`)}` +
      (hasil.grup.length > 0 ? ` • ${chalk.cyan(`${hasil.grup.length} grup`)}` : '');

    spinner.succeed(`Validasi selesai (${hasil.durasi}) — ${ringkas}`);
    return hasil;
  } catch (error) {
    spinner.fail(`Validasi gagal: ${error.message}`);
    throw error;
  }
}

/** Susun laporan teks dari hasil validasi. */
export function formatLaporan(hasil, { maks = MAKS_TAMPIL_LAPORAN } = {}) {
  const baris = [];
  baris.push(`Total diperiksa : ${hasil.total}`);
  baris.push(chalk.green(`Valid           : ${hasil.valid.length}`));
  baris.push(chalk.red(`Tidak valid     : ${hasil.tidakValid.length}`));
  if (hasil.grup.length > 0) baris.push(chalk.cyan(`Grup (dilewati) : ${hasil.grup.length}`));
  baris.push(`Durasi          : ${hasil.durasi}`);

  if (hasil.valid.length > 0) {
    baris.push('');
    baris.push(chalk.bold('Contoh nomor valid:'));
    hasil.valid.slice(0, maks).forEach((item) => {
      baris.push(`  ${chalk.green('✔')} ${item.nomor}${item.nama ? ` (${item.nama})` : ''}`);
    });
    if (hasil.valid.length > maks) baris.push(chalk.gray(`  ... dan ${hasil.valid.length - maks} nomor valid lainnya`));
  }

  if (hasil.tidakValid.length > 0) {
    baris.push('');
    baris.push(chalk.bold('Nomor tidak valid:'));
    hasil.tidakValid.slice(0, maks).forEach((item) => {
      baris.push(`  ${chalk.red('✖')} ${item.nomor} — ${item.alasan}`);
    });
    if (hasil.tidakValid.length > maks) {
      baris.push(chalk.gray(`  ... dan ${hasil.tidakValid.length - maks} nomor lainnya`));
    }
  }

  return baris;
}

/**
 * Simpan hasil dry run ke logs/.
 * @returns {{ok: boolean, nama?: string, path?: string, error?: string}}
 */
export function simpanHasilDryRun(hasil, meta = {}) {
  const detail = [
    ...hasil.valid.map((item) => ({ nomor: item.nomor, nama: item.nama, jid: item.jid, status: 'valid' })),
    ...hasil.grup.map((item) => ({ nomor: item.nomor, jid: item.jid, status: 'valid', catatan: 'grup' })),
    ...hasil.tidakValid.map((item) => ({
      nomor: item.nomor,
      nama: item.nama,
      jid: item.jid,
      status: 'tidak-valid',
      alasan: item.alasan,
    })),
  ];

  return simpanLog('dryrun', {
    timestamp: hasil.waktu,
    sumber: meta.sumber || '-',
    total: hasil.total,
    valid: hasil.valid.length + hasil.grup.length,
    tidakValid: hasil.tidakValid.length,
    grup: hasil.grup.length,
    durasi: hasil.durasi,
    durasiMs: hasil.durasiMs,
    detail,
  });
}

/** Spinner tiruan (tanpa output) untuk mode non-interaktif. */
export function spinnerSenyap() {
  const kosong = () => {};
  const tiruan = {
    text: '',
    start: kosong,
    stop: kosong,
    succeed: kosong,
    fail: kosong,
    warn: kosong,
    info: kosong,
    stopAndPersist: kosong,
  };
  return tiruan;
}
