/**
 * config.js — baca/tulis `config/settings.json` beserta validasi tipe.
 *
 * Prinsip: konfigurasi yang rusak tidak boleh membuat aplikasi gagal jalan.
 * Nilai yang tidak valid akan dikoreksi ke default dan dilaporkan sebagai
 * peringatan (bukan error fatal).
 */
import fs from 'node:fs';
import {
  CONFIG_DIR,
  SETTINGS_PATH,
  bacaJson,
  fileAda,
  pastikanFolder,
  tulisJson,
} from './utils.js';
import { parseProxy } from './proxy.js';

/** Konfigurasi default wabulk. */
export const DEFAULT_CONFIG = Object.freeze({
  perBatch: 15, // jumlah nomor per batch
  jeda: 15, // jeda antar batch (menit)
  jedaMin: 5, // jeda acak minimum antar nomor (detik)
  jedaMax: 10, // jeda acak maksimum antar nomor (detik)
  dryRun: false, // true = validasi nomor sebelum kirim
  prewarmSesi: true, // true = siapkan sesi enkripsi sebelum kirim (cegah "Menunggu pesan ini")
  logRetensi: 30, // log lebih lama dari ini (hari) dihapus otomatis
  proxy: null, // null atau { enabled, list: [], rotatePerBatch: true }
});

/** Kunci konfigurasi bertipe boolean. */
export const KUNCI_BOOLEAN = Object.freeze(['dryRun', 'prewarmSesi']);

/** Pertanyaan konfirmasi di menu Pengaturan untuk kunci boolean. */
export const PERTANYAAN_BOOLEAN = Object.freeze({
  dryRun: 'Aktifkan validasi nomor (dry run) sebelum kirim?',
  prewarmSesi: 'Aktifkan pramuat sesi enkripsi sebelum kirim (disarankan)?',
});

/** Batas nilai yang diterima untuk tiap kunci numerik. */
export const BATAS = Object.freeze({
  perBatch: { min: 1, max: 1000 },
  jeda: { min: 0, max: 1440 },
  jedaMin: { min: 0, max: 600 },
  jedaMax: { min: 0, max: 600 },
  logRetensi: { min: 1, max: 3650 },
});

/** Label ramah pengguna untuk menu Pengaturan. */
export const LABEL = Object.freeze({
  perBatch: 'Nomor per batch',
  jeda: 'Jeda antar batch (menit)',
  jedaMin: 'Jeda acak minimum (detik)',
  jedaMax: 'Jeda acak maksimum (detik)',
  dryRun: 'Validasi nomor sebelum kirim (dry run)',
  prewarmSesi: 'Pramuat sesi enkripsi sebelum kirim',
  logRetensi: 'Retensi log (hari)',
  proxy: 'Proxy',
});

export const URUTAN_KUNCI = Object.freeze([
  'perBatch',
  'jeda',
  'jedaMin',
  'jedaMax',
  'dryRun',
  'prewarmSesi',
  'logRetensi',
  'proxy',
]);

/** Ubah nilai apa pun menjadi bilangan bulat, atau undefined bila tidak wajar. */
function keBilanganBulat(nilai) {
  if (typeof nilai === 'string' && nilai.trim() === '') return undefined;
  const angka = Number(nilai);
  if (!Number.isFinite(angka)) return undefined;
  return Math.trunc(angka);
}

/**
 * Validasi + koreksi konfigurasi proxy.
 * @returns {null|{enabled:boolean, list:string[], rotatePerBatch:boolean}}
 */
function normalisasiProxy(mentah, errors) {
  if (mentah === null || mentah === undefined || mentah === false) return null;

  if (typeof mentah !== 'object' || Array.isArray(mentah)) {
    errors.push('Nilai "proxy" harus berupa objek atau null. Proxy dinonaktifkan.');
    return null;
  }

  const sumberList = Array.isArray(mentah.list) ? mentah.list : [];
  const list = [];

  sumberList.forEach((item, index) => {
    const hasil = parseProxy(item);
    if (hasil.ok) {
      if (!list.includes(hasil.url)) list.push(hasil.url); // buang duplikat
    } else {
      errors.push(`Proxy baris ${index + 1} tidak valid (${hasil.error}).`);
    }
  });

  if (list.length === 0) {
    if (sumberList.length > 0) errors.push('Tidak ada proxy valid, proxy dinonaktifkan.');
    return null;
  }

  return {
    enabled: mentah.enabled !== false,
    list,
    rotatePerBatch: mentah.rotatePerBatch !== false,
  };
}

/**
 * Normalisasi konfigurasi mentah (dari file / input pengguna).
 * @returns {{config: object, errors: string[], perbaikan: string[]}}
 */
export function normalisasiConfig(mentah = {}) {
  const sumber = mentah && typeof mentah === 'object' && !Array.isArray(mentah) ? mentah : {};
  const config = { ...DEFAULT_CONFIG };
  const errors = [];
  const perbaikan = [];

  if (mentah && (typeof mentah !== 'object' || Array.isArray(mentah))) {
    errors.push('Isi settings.json tidak berbentuk objek. Semua nilai kembali ke default.');
  }

  for (const kunci of ['perBatch', 'jeda', 'jedaMin', 'jedaMax', 'logRetensi']) {
    if (!(kunci in sumber)) continue;
    const nilai = keBilanganBulat(sumber[kunci]);
    const { min, max } = BATAS[kunci];

    if (nilai === undefined) {
      errors.push(`"${kunci}" harus berupa angka. Dipakai default (${DEFAULT_CONFIG[kunci]}).`);
      continue;
    }
    if (nilai < min || nilai > max) {
      config[kunci] = Math.min(max, Math.max(min, nilai));
      errors.push(`"${kunci}" di luar rentang ${min}-${max}. Dikoreksi menjadi ${config[kunci]}.`);
      perbaikan.push(kunci);
      continue;
    }
    config[kunci] = nilai;
    if (nilai !== Number(sumber[kunci])) perbaikan.push(kunci); // mis. "15.7" → 15
  }

  if ('dryRun' in sumber || 'prewarmSesi' in sumber) {
    for (const kunci of KUNCI_BOOLEAN) {
      if (!(kunci in sumber)) continue;
      const nilai = sumber[kunci];
      if (typeof nilai === 'boolean') {
        config[kunci] = nilai;
      } else if (nilai === 'true' || nilai === 'false') {
        config[kunci] = nilai === 'true';
        perbaikan.push(kunci);
      } else {
        errors.push(`"${kunci}" harus true/false. Dipakai default (${DEFAULT_CONFIG[kunci]}).`);
      }
    }
  }

  config.proxy = normalisasiProxy(sumber.proxy, errors);

  if (config.jedaMin > config.jedaMax) {
    const sementara = config.jedaMin;
    config.jedaMin = config.jedaMax;
    config.jedaMax = sementara;
    errors.push('"jedaMin" tidak boleh lebih besar dari "jedaMax". Keduanya ditukar otomatis.');
    perbaikan.push('jedaMin', 'jedaMax');
  }

  return { config, errors, perbaikan };
}

/**
 * Muat konfigurasi dari disk.
 * File rusak akan dicadangkan ke `settings.json.bak` lalu dibuat ulang.
 * @returns {{config: object, errors: string[], dibuat: boolean, dipulihkan: boolean, path: string}}
 */
export function loadConfig() {
  pastikanFolder(CONFIG_DIR);

  const adaFile = fileAda(SETTINGS_PATH);
  const mentah = adaFile ? bacaJson(SETTINGS_PATH, null) : null;
  const { config, errors, perbaikan } = normalisasiConfig(mentah ?? {});

  // Kunci baru (mis. setelah upgrade versi) ikut ditulis agar file konfigurasi
  // selalu memperlihatkan semua opsi yang tersedia.
  const kunciBaru = adaFile && mentah && typeof mentah === 'object'
    ? Object.keys(config).filter((kunci) => !(kunci in mentah))
    : [];

  let dibuat = false;
  let dipulihkan = false;

  if (adaFile && mentah === null) {
    // File ada tapi tidak bisa dibaca → cadangkan supaya data lama tidak hilang.
    try {
      fs.renameSync(SETTINGS_PATH, `${SETTINGS_PATH}.bak`);
      dipulihkan = true;
      errors.push('settings.json rusak/tidak valid. File lama dicadangkan ke settings.json.bak dan dibuat ulang.');
    } catch {
      errors.push('settings.json rusak dan gagal dicadangkan. Konfigurasi default dipakai di memori.');
    }
    try {
      tulisJson(SETTINGS_PATH, config);
      dibuat = true;
    } catch {
      /* biarkan berjalan dengan default di memori */
    }
  } else if (!adaFile) {
    try {
      tulisJson(SETTINGS_PATH, config);
      dibuat = true;
    } catch {
      errors.push('Tidak bisa menulis settings.json (folder tidak dapat ditulis?). Pengaturan hanya berlaku untuk sesi ini.');
    }
  } else if (perbaikan.length > 0 || kunciBaru.length > 0) {
    try {
      tulisJson(SETTINGS_PATH, config);
    } catch {
      /* tidak fatal */
    }
  }

  return { config, errors, dibuat, dipulihkan, path: SETTINGS_PATH };
}

/**
 * Simpan konfigurasi (selalu dinormalisasi dulu).
 * @returns {{ok: boolean, config: object, errors: string[], path: string, pesan: string}}
 */
export function saveConfig(mentah) {
  const { config, errors } = normalisasiConfig(mentah);
  try {
    pastikanFolder(CONFIG_DIR);
    tulisJson(SETTINGS_PATH, config);
    return {
      ok: true,
      config,
      errors,
      path: SETTINGS_PATH,
      pesan: `Pengaturan disimpan ke ${SETTINGS_PATH}`,
    };
  } catch (error) {
    return {
      ok: false,
      config,
      errors: [...errors, `Gagal menulis file: ${error.message}`],
      path: SETTINGS_PATH,
      pesan: 'Pengaturan gagal disimpan.',
    };
  }
}

/** Hapus file pengaturan dan pakai default (kembali ke setelan pabrik). */
export function resetConfig() {
  try {
    if (fileAda(SETTINGS_PATH)) fs.unlinkSync(SETTINGS_PATH);
    return { ok: true, config: { ...DEFAULT_CONFIG }, pesan: 'Pengaturan dikembalikan ke default.' };
  } catch (error) {
    return { ok: false, config: { ...DEFAULT_CONFIG }, pesan: `Gagal menghapus settings.json: ${error.message}` };
  }
}

/** Ringkasan singkat isi konfigurasi (untuk ditampilkan di menu). */
export function ringkasConfig(config) {
  const cfg = normalisasiConfig(config).config;
  const proxy = cfg.proxy
    ? `${cfg.proxy.list.length} proxy (${cfg.proxy.enabled ? 'aktif' : 'nonaktif'}${cfg.proxy.rotatePerBatch ? ', rotasi/batch' : ''})`
    : 'tidak dipakai';
  return [
    `Nomor per batch      : ${cfg.perBatch}`,
    `Jeda antar batch     : ${cfg.jeda} menit`,
    `Jeda acak antar nomor: ${cfg.jedaMin}-${cfg.jedaMax} detik`,
    `Validasi sebelum kirim: ${cfg.dryRun ? 'ya (dry run)' : 'tidak'}`,
    `Pramuat sesi         : ${cfg.prewarmSesi ? 'aktif (disarankan)' : 'nonaktif'}`,
    `Retensi log          : ${cfg.logRetensi} hari`,
    `Proxy                : ${proxy}`,
  ];
}

/** Nilai konfigurasi yang aman ditampilkan (proxy disamarkan password-nya). */
export function configUntukTampilan(config) {
  const cfg = normalisasiConfig(config).config;
  if (!cfg.proxy) return { ...cfg };
  return {
    ...cfg,
    proxy: {
      ...cfg.proxy,
      list: cfg.proxy.list.map((url) => url.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:••••@')),
    },
  };
}
