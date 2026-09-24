/**
 * media.js — deteksi tipe berkas, validasi, dan penyusunan objek pesan media
 * untuk Baileys.
 *
 * Berkas dibaca sebagai Buffer (bukan URL) agar stabil di Termux, di mana
 * `file://` sering bermasalah.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileAda, formatUkuran, potong, ukuranFile } from './utils.js';

/** Kategori media yang didukung beserta ekstensinya. */
export const KATEGORI_MEDIA = Object.freeze({
  gambar: { label: 'Gambar', ekstensi: ['.jpg', '.jpeg', '.png', '.webp'], maksByte: 16 * 1024 * 1024 },
  video: { label: 'Video', ekstensi: ['.mp4', '.mkv'], maksByte: 64 * 1024 * 1024 },
  dokumen: {
    label: 'Dokumen',
    ekstensi: ['.pdf', '.docx', '.xlsx', '.zip'],
    maksByte: 100 * 1024 * 1024,
  },
});

/** Peta MIME per ekstensi. */
export const MIME = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
});

/** Ekstensi berkas (lowercase, termasuk titik). */
export function ekstensiDari(filePath) {
  return path.extname(String(filePath ?? '')).toLowerCase();
}

/** MIME dari ekstensi (fallback: application/octet-stream). */
export function mimeDari(filePath) {
  return MIME[ekstensiDari(filePath)] || 'application/octet-stream';
}

/** Nama berkas tanpa folder. */
export function namaBerkas(filePath) {
  return path.basename(String(filePath ?? ''));
}

/**
 * Tentukan kategori media dari ekstensi file.
 * @returns {'gambar'|'video'|'dokumen'|null}
 */
export function deteksiTipeMedia(filePath) {
  const ext = ekstensiDari(filePath);
  if (!ext) return null;
  for (const [kategori, info] of Object.entries(KATEGORI_MEDIA)) {
    if (info.ekstensi.includes(ext)) return kategori;
  }
  return null;
}

/** Ringkasan ekstensi yang didukung (untuk ditampilkan ke pengguna). */
export function daftarEkstensi() {
  return Object.entries(KATEGORI_MEDIA).map(([, info]) => `${info.label}: ${info.ekstensi.join(', ')}`);
}

/**
 * Validasi berkas media sebelum dipakai.
 * @param {string} filePath
 * @param {string} [tipeDipaksa] 'gambar' | 'video' | 'dokumen'
 * @returns {{ok: boolean, tipe?: string, ekstensi?: string, nama?: string, ukuran?: number, ukuranTeks?: string, mime?: string, error?: string}}
 */
export function periksaMedia(filePath, tipeDipaksa = null) {
  const bersih = String(filePath ?? '').trim();
  if (!bersih) return { ok: false, error: 'Path berkas media kosong.' };
  if (!fileAda(bersih)) return { ok: false, error: `Berkas tidak ditemukan: ${bersih}` };

  let stat;
  try {
    stat = fs.statSync(bersih);
  } catch (error) {
    return { ok: false, error: `Berkas tidak bisa dibaca: ${error.message}` };
  }
  if (!stat.isFile()) return { ok: false, error: `Path bukan berkas biasa: ${bersih}` };

  const ext = ekstensiDari(bersih);
  const tipe = deteksiTipeMedia(bersih);

  if (!tipe) {
    return {
      ok: false,
      error: `Ekstensi "${ext || '(tanpa ekstensi)'}" belum didukung. Didukung → ${daftarEkstensi().join(' | ')}`,
    };
  }
  if (tipeDipaksa && tipeDipaksa !== tipe) {
    return {
      ok: false,
      error: `Berkas ${ext} adalah ${KATEGORI_MEDIA[tipe].label}, bukan ${KATEGORI_MEDIA[tipeDipaksa]?.label ?? tipeDipaksa}.`,
    };
  }

  const info = KATEGORI_MEDIA[tipe];
  if (stat.size > info.maksByte) {
    return {
      ok: false,
      error: `Ukuran ${formatUkuran(stat.size)} melebihi batas ${info.label} (${formatUkuran(info.maksByte)}).`,
    };
  }
  if (stat.size === 0) return { ok: false, error: 'Berkas kosong (0 byte).' };

  return {
    ok: true,
    tipe,
    ekstensi: ext,
    nama: namaBerkas(bersih),
    path: bersih,
    ukuran: stat.size,
    ukuranTeks: formatUkuran(stat.size),
    mime: mimeDari(bersih),
  };
}

/**
 * Susun objek pesan Baileys untuk berkas media.
 * @param {{filePath: string, tipe?: string, caption?: string}} opsi
 * @returns {Promise<{ok: boolean, isi?: object, tipe?: string, error?: string, info?: object}>}
 */
export async function bangunIsiMedia({ filePath, tipe = null, caption = '' }) {
  const info = periksaMedia(filePath, tipe);
  if (!info.ok) return { ok: false, error: info.error };

  let buffer;
  try {
    buffer = await fs.promises.readFile(info.path);
  } catch (error) {
    return { ok: false, error: `Gagal membaca berkas: ${error.message}` };
  }

  const teksCaption = typeof caption === 'string' ? caption : '';

  if (info.tipe === 'gambar') {
    return {
      ok: true,
      tipe: 'gambar',
      info,
      isi: { image: buffer, caption: teksCaption, mimetype: info.mime },
    };
  }

  if (info.tipe === 'video') {
    return {
      ok: true,
      tipe: 'video',
      info,
      isi: { video: buffer, caption: teksCaption, mimetype: info.mime, gifPlayback: false },
    };
  }

  return {
    ok: true,
    tipe: 'dokumen',
    info,
    isi: {
      document: buffer,
      mimetype: info.mime,
      fileName: info.nama,
      caption: teksCaption,
    },
  };
}

/** Ringkasan berkas media untuk ditampilkan di ringkasan/konfirmasi. */
export function ringkasMedia(info) {
  if (!info || !info.ok) return '-';
  return `${namaBerkas(info.path)} (${KATEGORI_MEDIA[info.tipe].label}, ${info.ukuranTeks})`;
}

/** Potongan path agar rapi di terminal. */
export function tampilkanPathMedia(filePath, maks = 60) {
  return potong(path.resolve(String(filePath ?? '')), maks);
}

/** Cek ukuran berkas tanpa validasi ekstensi (dipakai UI). */
export function ukuranMediaTeks(filePath) {
  return formatUkuran(ukuranFile(filePath));
}
