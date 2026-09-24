/**
 * template.js — mesin template pesan wabulk.
 *
 * Mendukung:
 * 1. Variabel  : {{nama}}, {{nomor}}, dst (diisi dari data penerima)
 * 2. Spintax   : {Halo|Hai|Selamat pagi} dipilih acak per penerima
 *    - Spintax bersarang didukung: {Halo {Bapak|Ibu}|Hai}
 */
import { angkaAcak } from './utils.js';

/** Ulangan maksimum saat membuka spintax bersarang (pengaman anti loop). */
const MAKS_PUTARAN_SPINTAX = 50;

/** Pola grup spintax: `{...}` tanpa kurung kurawal di dalamnya. */
const POLA_SPINTAX = /\{([^{}]*)\}/g;

/** Pola variabel: `{{nama}}` (spasi di sekitar nama diabaikan). */
const POLA_VARIABEL = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/** Variabel yang otomatis tersedia untuk setiap penerima. */
export const VARIABEL_BAWAAN = Object.freeze([
  'nomor',
  'nama',
  'jid',
  'index',
  'total',
  'tanggal',
  'jam',
]);

/** Normalisasi data penerima → map dengan kunci lowercase. */
function petaData(data = {}) {
  const peta = Object.create(null);
  if (!data || typeof data !== 'object') return peta;
  for (const [kunci, nilai] of Object.entries(data)) {
    if (nilai === undefined || nilai === null) continue;
    peta[String(kunci).toLowerCase()] = String(nilai);
  }
  return peta;
}

/**
 * Pilih satu opsi spintax secara acak, dari dalam ke luar (mendukung nesting).
 * Grup `{...}` yang tidak punya pemisah `|` dianggap teks biasa (dibiarkan).
 * @param {string} teks
 * @returns {string}
 */
export function renderSpintax(teks) {
  if (typeof teks !== 'string' || !teks.includes('{')) return String(teks ?? '');

  let hasil = teks;
  for (let putaran = 0; putaran < MAKS_PUTARAN_SPINTAX; putaran += 1) {
    let adaYangDiganti = false;

    hasil = hasil.replace(POLA_SPINTAX, (utuh, isi) => {
      const opsi = isi.split('|');
      if (opsi.length < 2) return utuh; // bukan spintax → biarkan apa adanya
      adaYangDiganti = true;
      return opsi[angkaAcak(0, opsi.length - 1)].trim();
    });

    if (!adaYangDiganti) break; // tidak ada lagi spintax bersarang
  }

  return hasil;
}

/**
 * Isi variabel `{{...}}` dari data penerima. Variabel tak dikenal → string kosong.
 * @param {string} teks
 * @param {object} data
 */
export function renderVariabel(teks, data = {}) {
  if (typeof teks !== 'string' || !teks.includes('{{')) return String(teks ?? '');
  const peta = petaData(data);

  return teks.replace(POLA_VARIABEL, (_utuh, kunci) => {
    const nilai = peta[String(kunci).toLowerCase()];
    return nilai === undefined ? '' : nilai;
  });
}

/**
 * Render penuh: variabel dulu (agar isi variabel tetap bisa berisi spintax),
 * lalu spintax.
 */
export function render(teks, data = {}) {
  return renderSpintax(renderVariabel(teks, data));
}

/** Daftar variabel unik yang dipakai di dalam teks. */
export function daftarVariabel(teks) {
  const hasil = new Set();
  if (typeof teks !== 'string') return [];
  for (const cocok of teks.matchAll(POLA_VARIABEL)) {
    hasil.add(cocok[1].toLowerCase());
  }
  return [...hasil];
}

/** True bila teks memakai minimal satu grup spintax. */
export function adaSpintax(teks) {
  if (typeof teks !== 'string') return false;
  return /\{[^{}]*\|[^{}]*\}/.test(teks);
}

/**
 * Periksa kesehatan template (kurung kurawal tidak seimbang, variabel tak dikenal).
 * @returns {{ok: boolean, variabel: string[], peringatan: string[]}}
 */
export function validasiTemplate(teks, variabelDikenal = VARIABEL_BAWAAN) {
  const peringatan = [];
  if (typeof teks !== 'string' || teks.trim() === '') {
    return { ok: false, variabel: [], peringatan: ['Template pesan kosong.'] };
  }

  const dipakai = daftarVariabel(teks);
  const dikenal = new Set((variabelDikenal || []).map((v) => String(v).toLowerCase()));
  const asing = dipakai.filter((v) => !dikenal.has(v));
  if (asing.length > 0) {
    peringatan.push(
      `Variabel tidak dikenal akan dihapus dari pesan: ${asing.map((v) => `{{${v}}}`).join(', ')}`,
    );
  }

  // Cek keseimbangan kurung kurawal (variabel diabaikan dulu).
  const tanpaVariabel = teks.replace(POLA_VARIABEL, '');
  let tingkat = 0;
  let tidakSeimbang = false;
  for (const karakter of tanpaVariabel) {
    if (karakter === '{') tingkat += 1;
    else if (karakter === '}') {
      tingkat -= 1;
      if (tingkat < 0) {
        tidakSeimbang = true;
        break;
      }
    }
  }
  if (tidakSeimbang || tingkat !== 0) {
    peringatan.push('Jumlah kurung kurawal { } tidak seimbang. Periksa kembali spintax Anda.');
  }

  return { ok: peringatan.length === 0, variabel: dipakai, peringatan };
}

/**
 * Preview hasil render untuk beberapa penerima pertama.
 * @returns {Array<{nomor: string, nama: string, hasil: string}>}
 */
export function preview(teks, daftar = [], jumlah = 3) {
  const contoh = daftar.slice(0, Math.max(1, jumlah));
  const total = daftar.length;

  return contoh.map((item, index) => ({
    nomor: item.nomor || item.jid || '-',
    nama: item.nama || '-',
    hasil: render(teks, susunDataPenerima(item, index, total)),
  }));
}

/**
 * Susun data yang tersedia untuk template dari satu penerima.
 * @param {object} item {nomor, nama, jid}
 * @param {number} index urutan ke-berapa (0-based)
 * @param {number} total jumlah penerima
 */
export function susunDataPenerima(item = {}, index = 0, total = 0, tanggal = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    nomor: item.nomor || '',
    nama: item.nama || '',
    jid: item.jid || '',
    index: String(index + 1),
    total: String(total || 0),
    tanggal: `${p(tanggal.getDate())}/${p(tanggal.getMonth() + 1)}/${tanggal.getFullYear()}`,
    jam: `${p(tanggal.getHours())}:${p(tanggal.getMinutes())}`,
  };
}

/** Buat beberapa contoh variasi spintax (untuk ditampilkan sebelum kirim). */
export function contohVariasi(teks, jumlah = 3) {
  const variasi = new Set();
  const maks = Math.max(1, jumlah);
  for (let i = 0; i < maks * 4 && variasi.size < maks; i += 1) {
    variasi.add(renderSpintax(teks));
  }
  return [...variasi];
}

/**
 * Rapikan pesan dari input pengguna: ubah "\n" literal menjadi baris baru asli
 * dan buang spasi berlebih di ujung.
 */
export function rapikanPesan(teks) {
  return String(teks ?? '')
    .replace(/\\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}
