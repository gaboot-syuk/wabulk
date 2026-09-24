/**
 * logger.js — pencatatan sesi (bulk & dry run) ke folder `logs/`.
 *
 * Format file: JSON satu objek per file, nama file memakai stempel waktu
 * sehingga mudah diurutkan: `2026-09-24T10-30-00_bulk.json`.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  LOGS_DIR,
  bacaJson,
  formatTanggalWaktu,
  formatUkuran,
  labelStatusAck,
  pastikanFolder,
  potong,
  stempelWaktuFile,
  tulisJson,
} from './utils.js';

/** Tipe log yang dikenal. */
export const TIPE_LOG = Object.freeze({ BULK: 'bulk', DRYRUN: 'dryrun', DIAGNOSA: 'diagnosa' });

/** Pola nama file log: <stempel>_<tipe>[-urutan].json */
const POLA_NAMA = /^(.+?)_([a-z]+)(?:-(\d+))?\.json$/i;

/** Nama file log baru untuk tipe tertentu. */
export function namaFileLog(tipe, tanggal = new Date()) {
  return `${stempelWaktuFile(tanggal)}_${tipe}.json`;
}

/**
 * Simpan hasil satu sesi ke logs/.
 * @param {string} tipe 'bulk' | 'dryrun'
 * @param {object} data isi log
 * @returns {{ok: boolean, nama?: string, path?: string, error?: string}}
 */
export function simpanLog(tipe, data = {}) {
  try {
    pastikanFolder(LOGS_DIR);

    let nama = namaFileLog(tipe);
    let target = path.join(LOGS_DIR, nama);
    let urutan = 1;
    // Hindari menimpa bila ada dua sesi pada detik yang sama.
    while (fs.existsSync(target)) {
      nama = `${stempelWaktuFile()}_${tipe}-${urutan}.json`;
      target = path.join(LOGS_DIR, nama);
      urutan += 1;
    }

    const isi = {
      tipe,
      dibuatPada: new Date().toISOString(),
      ...data,
    };

    tulisJson(target, isi);
    return { ok: true, nama, path: target };
  } catch (error) {
    return { ok: false, error: `Gagal menyimpan log: ${error.message}` };
  }
}

/**
 * Daftar file log (terbaru lebih dulu).
 * @param {{tipe?: string|null, limit?: number}} opsi
 * @returns {Array<{nama: string, path: string, tipe: string, ukuran: number, ukuranTeks: string, waktuUbah: number, waktuTeks: string}>}
 */
export function daftarLog({ tipe = null, limit = 50 } = {}) {
  try {
    pastikanFolder(LOGS_DIR);
    const berkas = fs
      .readdirSync(LOGS_DIR)
      .filter((nama) => nama.toLowerCase().endsWith('.json'));

    const daftar = berkas
      .map((nama) => {
        const target = path.join(LOGS_DIR, nama);
        let stat;
        try {
          stat = fs.statSync(target);
        } catch {
          return null;
        }
        const cocok = POLA_NAMA.exec(nama);
        return {
          nama,
          path: target,
          tipe: cocok ? cocok[2].toLowerCase() : 'lainnya',
          ukuran: stat.size,
          ukuranTeks: formatUkuran(stat.size),
          waktuUbah: stat.mtimeMs,
          waktuTeks: formatTanggalWaktu(stat.mtime),
        };
      })
      .filter(Boolean)
      .filter((item) => (tipe ? item.tipe === tipe : true))
      .sort((a, b) => b.waktuUbah - a.waktuUbah);

    return typeof limit === 'number' && limit > 0 ? daftar.slice(0, limit) : daftar;
  } catch {
    return [];
  }
}

/** Baca satu file log. */
export function bacaLog(filePath) {
  return bacaJson(filePath, null);
}

/** Daftar log + isinya (hanya baris terbaru sesuai limit). */
export function bacaRiwayat({ tipe = null, limit = 20 } = {}) {
  return daftarLog({ tipe, limit }).map((meta) => ({
    ...meta,
    isi: bacaLog(meta.path),
  }));
}

/**
 * Hapus log yang lebih lama dari `hari` hari.
 * @returns {{dihapus: string[], jumlah: number}}
 */
export function hapusLogLama(hari) {
  const batasHari = Number(hari);
  const dihapus = [];
  if (!Number.isFinite(batasHari) || batasHari <= 0) return { dihapus, jumlah: 0 };

  const batasWaktu = Date.now() - batasHari * 24 * 60 * 60 * 1000;

  try {
    pastikanFolder(LOGS_DIR);
    for (const nama of fs.readdirSync(LOGS_DIR)) {
      if (!nama.toLowerCase().endsWith('.json')) continue;
      const target = path.join(LOGS_DIR, nama);
      try {
        const stat = fs.statSync(target);
        if (stat.mtimeMs < batasWaktu) {
          fs.unlinkSync(target);
          dihapus.push(nama);
        }
      } catch {
        /* lewati file yang tidak bisa dibaca */
      }
    }
  } catch {
    /* folder tidak terbaca → tidak ada yang dihapus */
  }

  return { dihapus, jumlah: dihapus.length };
}

/** Ambil angka dari objek dengan aman. */
function angka(nilai, fallback = 0) {
  const n = Number(nilai);
  return Number.isFinite(n) ? n : fallback;
}

/** Ringkasan satu baris untuk daftar riwayat. */
export function ringkasLog(log, meta = {}) {
  if (!log || typeof log !== 'object') {
    return {
      judul: meta.nama || 'Log tidak terbaca',
      keterangan: 'File rusak atau bukan JSON wabulk.',
      tipe: 'lainnya',
    };
  }

  const total = angka(log.total, log.detail?.length ?? 0);
  const tipe = (log.tipe || meta.tipe || 'lainnya').toLowerCase();
  const waktu = log.timestamp || log.dibuatPada || meta.waktuTeks || '-';

  if (tipe === 'dryrun') {
    return {
      judul: `Dry run • ${formatTanggalWaktu(waktu)}`,
      keterangan: `${total} nomor diperiksa • ${angka(log.valid)} valid • ${angka(log.tidakValid)} tidak valid`,
      tipe,
      file: meta.nama,
    };
  }

  if (tipe === 'diagnosa') {
    return {
      judul: `Diagnosa • ${formatTanggalWaktu(waktu)}`,
      keterangan:
        `tujuan ${log.tujuan || '-'} • ${log.statusAkhirTeks || 'tidak ada ack'}` +
        ` • retry dilayani: ${angka(log.retryDilayani)}`,
      tipe,
      file: meta.nama,
    };
  }

  const terkirim = angka(log.terkirim);
  const gagal = angka(log.gagal);
  const persen = total > 0 ? Math.round((terkirim / total) * 100) : 0;
  return {
    judul: `Bulk • ${formatTanggalWaktu(waktu)}`,
    keterangan: `${total} nomor • ${terkirim} terkirim • ${gagal} gagal (${persen}%) • ${log.durasi || '-'}`,
    tipe,
    file: meta.nama,
  };
}

/** Rincian lengkap satu log untuk ditampilkan di terminal. */
export function detailLog(log, maksDetail = 20) {
  const baris = [];
  if (!log || typeof log !== 'object') return ['Isi log tidak dapat dibaca.'];

  baris.push(`Tipe        : ${log.tipe || '-'}`);
  baris.push(`Waktu       : ${formatTanggalWaktu(log.timestamp || log.dibuatPada || new Date())}`);
  if (log.sumber) baris.push(`Sumber nomor: ${log.sumber}`);
  if (log.tipePesan) baris.push(`Tipe pesan  : ${log.tipePesan}`);
  if (log.media) baris.push(`Berkas media: ${potong(log.media, 70)}`);

  if ((log.tipe || '').toLowerCase() === 'dryrun') {
    baris.push(`Total       : ${angka(log.total)} nomor`);
    baris.push(`Valid       : ${angka(log.valid)}`);
    baris.push(`Tidak valid : ${angka(log.tidakValid)}`);
    if (Array.isArray(log.detail)) {
      baris.push('');
      baris.push(`Contoh hasil (maks ${maksDetail}):`);
      log.detail.slice(0, maksDetail).forEach((item) => {
        baris.push(`  ${item.status === 'valid' ? '✔' : '✖'} ${item.nomor || item.jid}${item.alasan ? ` — ${item.alasan}` : ''}`);
      });
    }
    return baris;
  }

  if ((log.tipe || '').toLowerCase() === 'diagnosa') {
    baris.push(`Akun        : ${log.akun || '-'}`);
    baris.push(`Tujuan uji  : ${log.tujuan || '-'}`);
    baris.push(`Status akhir: ${log.statusAkhirTeks || labelStatusAck(log.statusAkhir)}${log.tercapai ? ' ✔' : ''}`);
    baris.push(`Durasi      : ${log.durasi || '-'}`);
    baris.push(`Retry dilayani: ${angka(log.retryDilayani)}`);
    if (Array.isArray(log.riwayatStatus) && log.riwayatStatus.length > 0) {
      baris.push('Riwayat status:');
      log.riwayatStatus.forEach((item) => {
        baris.push(`  • ${labelStatusAck(item.status)} — ${item.waktuMs} ms`);
      });
    }
    if (Array.isArray(log.catatan) && log.catatan.length > 0) {
      baris.push('');
      baris.push('Catatan:');
      log.catatan.forEach((pesan) => baris.push(`  ${pesan}`));
    }
    return baris;
  }

  baris.push(`Total nomor : ${angka(log.total)}`);
  baris.push(`Terkirim    : ${angka(log.terkirim)}`);
  baris.push(`Gagal       : ${angka(log.gagal)}`);
  baris.push(`Durasi      : ${log.durasi || '-'}`);
  if (log.perBatch || log.jeda) baris.push(`Batch       : ${angka(log.perBatch)} nomor / jeda ${angka(log.jeda)} menit`);
  if (log.dibatalkan) baris.push('Catatan     : sesi dihentikan lebih awal oleh pengguna');

  if (Array.isArray(log.detail) && log.detail.length > 0) {
    baris.push('');
    baris.push(`Rincian (maks ${maksDetail} dari ${log.detail.length}):`);
    log.detail.slice(0, maksDetail).forEach((item) => {
      const tanda = item.status === 'sent' ? '✔' : '✖';
      const nama = item.nama ? ` (${item.nama})` : '';
      const alasan = item.error ? ` — ${item.error}` : '';
      baris.push(`  ${tanda} ${item.nomor || item.jid}${nama}${alasan}`);
    });
  } else if (Array.isArray(log.gagalDetail) && log.gagalDetail.length > 0) {
    baris.push('');
    baris.push(`Contoh kegagalan (maks ${maksDetail}):`);
    log.gagalDetail.slice(0, maksDetail).forEach((item) => {
      baris.push(`  ✖ ${item.nomor || item.jid} — ${item.error || 'tidak diketahui'}`);
    });
  }

  return baris;
}

/** Statistik ringan isi folder logs/ (untuk header menu riwayat). */
export function statistikLog() {
  const daftar = daftarLog({ limit: 0 });
  const ukuranTotal = daftar.reduce((total, item) => total + item.ukuran, 0);
  return {
    total: daftar.length,
    bulk: daftar.filter((item) => item.tipe === 'bulk').length,
    dryrun: daftar.filter((item) => item.tipe === 'dryrun').length,
    diagnosa: daftar.filter((item) => item.tipe === 'diagnosa').length,
    ukuranTotal,
    ukuranTeks: formatUkuran(ukuranTotal),
  };
}

/** Jalankan pembersihan retensi log (dipanggil saat startup). */
export function bersihkanLogLama(hari) {
  const hasil = hapusLogLama(hari);
  return hasil;
}
