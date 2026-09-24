/**
 * utils.js — helper umum yang dipakai seluruh modul wabulk.
 *
 * Semua fungsi di sini bebas dependensi (hanya `fs`, `path`, `url` bawaan Node)
 * agar bisa diimpor dari mana saja tanpa risiko circular import.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Lokasi folder project
// Dihitung dari lokasi file ini (bukan dari process.cwd()) supaya tetap benar
// walau perintah dijalankan dari folder lain, mis. lewat `npm link`.
// ---------------------------------------------------------------------------
const FILE_INI = fileURLToPath(import.meta.url);
const DIR_INI = path.dirname(FILE_INI);

export const ROOT_DIR = path.resolve(DIR_INI, '..');
export const CONFIG_DIR = path.join(ROOT_DIR, 'config');
export const AUTH_DIR = path.join(ROOT_DIR, 'auth_info');
export const LOGS_DIR = path.join(ROOT_DIR, 'logs');
export const EXAMPLES_DIR = path.join(ROOT_DIR, 'examples');
export const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json');

// ---------------------------------------------------------------------------
// Konstanta aplikasi
// ---------------------------------------------------------------------------
export const NAMA_APP = 'wabulk';
export const VERSI_APP = '1.0.0';
export const NODE_MINIMAL = 20;

export const JID_INDIVIDU = '@s.whatsapp.net';
export const JID_GRUP = '@g.us';
export const KODE_NEGARA_DEFAULT = '62';

export const MIN_PANJANG_NOMOR = 9;
export const MAX_PANJANG_NOMOR = 15;

export const NAMA_FILE_KONTAK_CONTOH = 'nomor.txt';

// ---------------------------------------------------------------------------
// Waktu & angka
// ---------------------------------------------------------------------------

/** Jeda sederhana (Promise) — dipakai untuk semua delay di wabulk. */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Jeda dalam satuan detik. */
export function delayDetik(detik) {
  return delay(Number(detik) * 1000);
}

/** Bilangan bulat acak antara min dan max (inklusif). */
export function angkaAcak(min, max) {
  const bawah = Math.ceil(Math.min(min, max));
  const atas = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (atas - bawah + 1)) + bawah;
}

/** Ambil satu elemen acak dari array. */
export function pilihAcak(daftar) {
  if (!Array.isArray(daftar) || daftar.length === 0) return undefined;
  return daftar[angkaAcak(0, daftar.length - 1)];
}

/**
 * Jeda acak antar nomor (detik). Dipakai sender supaya pola kirim
 * tidak terlihat kaku/mesin.
 */
export function jedaAcakDetik(min, max) {
  const detik = angkaAcak(min, max);
  return { detik, promise: delayDetik(detik) };
}

/** Format durasi dari milidetik → "1j 20m 5d". */
export function formatDurasi(ms) {
  const totalDetik = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const jam = Math.floor(totalDetik / 3600);
  const menit = Math.floor((totalDetik % 3600) / 60);
  const detik = totalDetik % 60;
  const bagian = [];
  if (jam > 0) bagian.push(`${jam}j`);
  if (menit > 0) bagian.push(`${menit}m`);
  bagian.push(`${detik}d`);
  return bagian.join(' ');
}

/** Format hitung mundur mm:ss (atau h:mm:ss bila lebih dari 1 jam). */
export function formatHitungMundur(totalDetik) {
  const detik = Math.max(0, Math.floor(totalDetik));
  const jam = Math.floor(detik / 3600);
  const menit = Math.floor((detik % 3600) / 60);
  const sisa = detik % 60;
  const p = (n) => String(n).padStart(2, '0');
  if (jam > 0) return `${jam}:${p(menit)}:${p(sisa)}`;
  return `${p(menit)}:${p(sisa)}`;
}

/** Stempel waktu yang aman dipakai sebagai nama file: 2026-09-24T10-30-00. */
export function stempelWaktuFile(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
  );
}

/** Tanggal-waktu ramah dibaca: "24 Sep 2026, 10:30". */
export function formatTanggalWaktu(nilai) {
  const date = nilai instanceof Date ? nilai : new Date(nilai);
  if (Number.isNaN(date.getTime())) return String(nilai ?? '-');
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    // Fallback bila ICU tidak tersedia (Node build kecil)
    return date.toISOString().replace('T', ' ').slice(0, 16);
  }
}

// ---------------------------------------------------------------------------
// Nomor & JID
// ---------------------------------------------------------------------------

/** True bila JID adalah grup WhatsApp. */
export function isJidGrup(jid) {
  return typeof jid === 'string' && jid.trim().toLowerCase().endsWith(JID_GRUP);
}

/**
 * Bersihkan input nomor:
 * - "0812-3456-7890" / "+62 812 3456 7890" / "62812.3456.7890" → "6281234567890"
 * - "08123456789" → "628123456789" (awalan 0 diganti kode negara default)
 * - "81234567890" → "6281234567890"
 * - "120363xxx@g.us" (JID grup) → dikembalikan apa adanya (lowercase)
 */
export function sanitizeNomor(input) {
  if (input === null || input === undefined) return '';
  let teks = String(input).trim();
  if (!teks) return '';

  // JID yang sudah lengkap (individu/grup) dibiarkan
  if (teks.includes('@')) return teks.toLowerCase();

  teks = teks.replace(/[^\d]/g, ''); // buang +, spasi, -, titik, tanda kurung
  if (!teks) return '';

  if (teks.startsWith('00')) teks = teks.slice(2); // 00628xxx → 628xxx
  if (teks.startsWith('0')) return KODE_NEGARA_DEFAULT + teks.slice(1);
  if (teks.startsWith('8')) return KODE_NEGARA_DEFAULT + teks;
  return teks;
}

/** Bentuk JID WhatsApp dari nomor. */
export function parseJid(nomor) {
  const bersih = sanitizeNomor(nomor);
  if (!bersih) return '';
  if (bersih.includes('@')) return bersih;
  return `${bersih}${JID_INDIVIDU}`;
}

/** Ambil bagian nomor (tanpa domain JID). */
export function nomorDariJid(jid) {
  if (typeof jid !== 'string') return '';
  const pisah = jid.indexOf('@');
  return pisah === -1 ? jid : jid.slice(0, pisah);
}

/**
 * Validasi + normalisasi satu input nomor.
 * @returns {{ok: boolean, nomor: string, jid: string, adalahGrup: boolean, error?: string}}
 */
export function normalisasiNomor(input) {
  const kosong = { ok: false, nomor: '', jid: '', adalahGrup: false };
  if (input === null || input === undefined || String(input).trim() === '') {
    return { ...kosong, error: 'Nomor kosong' };
  }

  const bersih = sanitizeNomor(input);
  if (!bersih) return { ...kosong, error: 'Nomor tidak berisi angka' };

  if (bersih.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+$/.test(bersih)) {
      return { ...kosong, nomor: bersih, error: 'Format JID tidak valid' };
    }
    return { ok: true, nomor: nomorDariJid(bersih), jid: bersih, adalahGrup: isJidGrup(bersih) };
  }

  if (!/^\d+$/.test(bersih)) return { ...kosong, nomor: bersih, error: 'Nomor harus berupa angka' };
  if (bersih.length < MIN_PANJANG_NOMOR || bersih.length > MAX_PANJANG_NOMOR) {
    return {
      ...kosong,
      nomor: bersih,
      error: `Panjang nomor tidak wajar (${bersih.length} digit, harus ${MIN_PANJANG_NOMOR}-${MAX_PANJANG_NOMOR})`,
    };
  }

  return { ok: true, nomor: bersih, jid: `${bersih}${JID_INDIVIDU}`, adalahGrup: false };
}

/**
 * Parse satu baris file/teks nomor.
 * Format didukung: "6281234567890", "6281234567890,Budi", "6281234567890;Budi".
 * Baris diawali '#' dianggap komentar.
 * @returns {{ok: boolean, nomor: string, nama: string, jid: string, adalahGrup: boolean, alasan?: string}}
 */
export function parseBarisNomor(baris) {
  const mentah = String(baris ?? '').trim();
  if (!mentah || mentah.startsWith('#')) return { ok: false, nomor: '', nama: '', jid: '', adalahGrup: false, alasan: 'kosong/komentar' };

  const pemisah = mentah.includes(',') ? ',' : mentah.includes(';') ? ';' : null;
  const bagian = pemisah ? mentah.split(pemisah) : [mentah];
  const nomorMentah = bagian[0];
  // Nama boleh mengandung koma tambahan, gabungkan sisanya.
  const nama = bagian.slice(1).join(' ').trim();

  const hasil = normalisasiNomor(nomorMentah);
  if (!hasil.ok) {
    return { ok: false, nomor: String(nomorMentah).trim(), nama, jid: '', adalahGrup: false, alasan: hasil.error };
  }
  return { ok: true, nomor: hasil.nomor, nama, jid: hasil.jid, adalahGrup: hasil.adalahGrup };
}

/**
 * Baca file daftar nomor (.txt).
 * @param {string} filePath
 * @returns {{daftar: Array, dilewati: Array, totalBaris: number, file: string}}
 */
export function bacaFileNomor(filePath) {
  const isi = fs.readFileSync(filePath, 'utf8');
  const baris = isi.split(/\r?\n/);
  const daftar = [];
  const dilewati = [];

  baris.forEach((teks, index) => {
    if (!teks.trim() || teks.trim().startsWith('#')) return;
    const hasil = parseBarisNomor(teks);
    if (hasil.ok) {
      daftar.push({ ...hasil, sumberBaris: index + 1 });
    } else {
      dilewati.push({ baris: index + 1, teks: teks.trim(), alasan: hasil.alasan });
    }
  });

  return { daftar, dilewati, totalBaris: baris.length, file: filePath };
}

/**
 * Parse input manual.
 *
 * Mendukung dua gaya sekaligus:
 * - beberapa nomor dipisah koma / titik koma / baris baru → menjadi entri terpisah
 * - format "nomor,nama" untuk personalisasi → tetap satu entri
 *
 * Aturan: bila semua bagian hasil pemisahan koma adalah nomor valid, maka
 * dianggap daftar nomor; bila ada bagian yang bukan nomor (mis. nama), maka
 * baris itu dianggap format "nomor,nama".
 */
export function parseInputManual(teks) {
  const daftar = [];
  const dilewati = [];

  const baris = String(teks ?? '')
    .split(/[\n\r;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const bagianMentah = [];
  for (const satuBaris of baris) {
    if (satuBaris.includes(',')) {
      const potongan = satuBaris.split(',').map((t) => t.trim()).filter(Boolean);
      const semuaNomor = potongan.length > 1 && potongan.every((bagian) => normalisasiNomor(bagian).ok);
      if (semuaNomor) {
        bagianMentah.push(...potongan);
        continue;
      }
    }
    bagianMentah.push(satuBaris);
  }

  bagianMentah.forEach((bagian) => {
    const hasil = parseBarisNomor(bagian);
    if (hasil.ok) daftar.push({ ...hasil, sumberBaris: null });
    else dilewati.push({ baris: null, teks: bagian, alasan: hasil.alasan });
  });

  return { daftar, dilewati, totalBaris: bagianMentah.length, file: null };
}

/** Buang nomor duplikat (berdasarkan JID), urutan pertama dipertahankan. */
export function bersihkanDuplikat(daftar) {
  const terlihat = new Set();
  const unik = [];
  const duplikat = [];
  for (const item of daftar) {
    const kunci = (item.jid || item.nomor || '').toLowerCase();
    if (!kunci) continue;
    if (terlihat.has(kunci)) duplikat.push(item);
    else {
      terlihat.add(kunci);
      unik.push(item);
    }
  }
  return { daftar: unik, duplikat };
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

/** Buat folder (rekursif) bila belum ada. */
export function pastikanFolder(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (error) {
    return { error };
  }
}

/** True bila path ada. */
export function fileAda(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

/** Baca JSON dengan aman; kembalikan `fallback` bila gagal. */
export function bacaJson(filePath, fallback = null) {
  try {
    const isi = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(isi);
  } catch {
    return fallback;
  }
}

/** Tulis JSON (pretty print) + buat folder induknya bila perlu. */
export function tulisJson(filePath, data) {
  pastikanFolder(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return filePath;
}

/** Ukuran file dalam byte (0 bila tidak ada). */
export function ukuranFile(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/** Format ukuran byte → "12,4 KB". */
export function formatUkuran(byte) {
  const angka = Number(byte) || 0;
  if (angka < 1024) return `${angka} B`;
  const satuan = ['KB', 'MB', 'GB', 'TB'];
  let nilai = angka / 1024;
  let index = 0;
  while (nilai >= 1024 && index < satuan.length - 1) {
    nilai /= 1024;
    index += 1;
  }
  return `${nilai.toFixed(1).replace('.', ',')} ${satuan[index]}`;
}

/** Potong teks panjang untuk tampilan terminal. */
export function potong(teks, maks = 60) {
  const sumber = String(teks ?? '');
  if (sumber.length <= maks) return sumber;
  return `${sumber.slice(0, Math.max(0, maks - 1))}…`;
}

/** Buang karakter kontrol aneh dari input pengguna. */
export function rapikanInput(teks) {
  return String(teks ?? '').replace(/\u0000/g, '').trim();
}

// ---------------------------------------------------------------------------
// Sinyal pembatalan (Ctrl+C / pilihan "Batal")
// ---------------------------------------------------------------------------

/** Buat token pembatalan sederhana yang bisa dicek di dalam loop panjang. */
export function buatSinyal() {
  return {
    dibatalkan: false,
    batalkan() {
      this.dibatalkan = true;
    },
  };
}

/** Lempar error bila sinyal sudah dibatalkan. */
export function cekSinyal(sinyal) {
  if (sinyal && sinyal.dibatalkan) {
    const error = new Error('DIBATALKAN');
    error.kode = 'DIBATALKAN';
    throw error;
  }
}

/** Error khusus ketika pengguna memilih keluar dari menu (Ctrl+C / Batal). */
export class KeluarError extends Error {
  constructor(pesan = 'Dibatalkan oleh pengguna') {
    super(pesan);
    this.name = 'KeluarError';
    this.kode = 'KELUAR';
  }
}

/** True bila error adalah error pembatalan/keluar. */
export function isDibatalkan(error) {
  return Boolean(error) && (error.kode === 'DIBATALKAN' || error.kode === 'KELUAR' || error.name === 'KeluarError');
}

// ---------------------------------------------------------------------------
// Lingkungan
// ---------------------------------------------------------------------------

/**
 * Cek versi Node.js.
 * @returns {{ok: boolean, versi: string, minimal: number}}
 */
export function cekVersiNode(minimal = NODE_MINIMAL) {
  const versi = process.versions.node || '0.0.0';
  const mayor = Number.parseInt(versi.split('.')[0], 10) || 0;
  return { ok: mayor >= minimal, versi, minimal };
}

/** Buat ID sesi ringkas untuk log: "20260924-103000-4f2a". */
export function buatIdSesi() {
  const acak = Math.random().toString(16).slice(2, 6);
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${acak}`
  );
}

/** Sapa pengguna sesuai jam lokal (dipakai di UI). */
export function salamWaktu(date = new Date()) {
  const jam = date.getHours();
  if (jam < 4) return 'Selamat dini hari';
  if (jam < 11) return 'Selamat pagi';
  if (jam < 15) return 'Selamat siang';
  if (jam < 18) return 'Selamat sore';
  return 'Selamat malam';
}

// ---------------------------------------------------------------------------
// Status pengiriman (ack) WhatsApp
// ---------------------------------------------------------------------------

/**
 * Kode status ack Baileys (proto.WebMessageInfo.Status).
 * Dipakai untuk fitur diagnosa pengiriman.
 */
export const STATUS_ACK = Object.freeze({
  0: 'GAGAL (ERROR)',
  1: 'PENDING (belum terkirim)',
  2: 'SERVER_ACK (diterima server WhatsApp)',
  3: 'DELIVERY_ACK (sampai perangkat penerima)',
  4: 'READ (dibaca penerima)',
  5: 'PLAYED (media diputar)',
});

/** Label ramah untuk kode status ack. */
export function labelStatusAck(status) {
  if (status === null || status === undefined) return 'tidak ada ack';
  return STATUS_ACK[status] || `status tidak dikenal (${status})`;
}

/** Status ack yang dianggap "tuntas" (pesan sampai perangkat/baca). */
export const STATUS_ACK_TUNTAS = 3;
