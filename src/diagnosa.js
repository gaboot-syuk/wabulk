/**
 * diagnosa.js — cek kesehatan pengiriman.
 *
 * Cara kerja:
 * 1. Pastikan koneksi WhatsApp siap.
 * 2. Kirim satu pesan uji (default ke nomor akun sendiri).
 * 3. Pantau status pengiriman (ack) sampai DELIVERY_ACK/READ atau waktu habis.
 * 4. Laporkan apakah mekanisme anti "Menunggu pesan ini" (retry) bekerja.
 * 5. Simpan hasil ke logs/ sebagai tipe `diagnosa`.
 */
import chalk from 'chalk';
import ora from 'ora';
import {
  formatDurasi,
  labelStatusAck,
  normalisasiNomor,
  potong,
  STATUS_ACK_TUNTAS,
} from './utils.js';
import { susunDataPenerima, render } from './template.js';
import { simpanLog } from './logger.js';
import { spinnerSenyap } from './dryrun.js';

/** Teks pesan uji default. */
export const PESAN_UJI_DEFAULT = '[wabulk] Pesan uji diagnosa. Balasan tidak diperlukan.';

/** Waktu tunggu default untuk ack (ms). */
export const TIMEOUT_DIAGNOSA_MS = 45000;

/**
 * Jalankan diagnosa pengiriman.
 * @param {object} opsi
 * @param {object} opsi.klien instance KlienWhatsApp
 * @param {string|null} [opsi.tujuan] nomor tujuan uji (default: nomor akun sendiri)
 * @param {string} [opsi.pesanUji] teks pesan uji
 * @param {number} [opsi.timeoutMs] batas waktu menunggu ack
 * @param {boolean} [opsi.cetakProgres] tampilkan spinner
 * @param {Function} [opsi.onStatus] callback (entri) setiap ack masuk
 * @param {boolean} [opsi.simpan] simpan hasil ke logs/
 * @returns {Promise<object>} laporan diagnosa
 */
export async function jalankanDiagnosa(opsi = {}) {
  const {
    klien,
    tujuan = null,
    pesanUji = PESAN_UJI_DEFAULT,
    timeoutMs = TIMEOUT_DIAGNOSA_MS,
    cetakProgres = true,
    onStatus = null,
    simpan = true,
  } = opsi;

  if (!klien) throw new Error('Klien WhatsApp tidak tersedia.');
  if (typeof klien.tungguSiap !== 'function' || typeof klien.kirim !== 'function') {
    throw new Error('Klien WhatsApp tidak mendukung diagnosa.');
  }

  const spinner = cetakProgres ? ora() : spinnerSenyap();
  const mulai = Date.now();

  spinner.start('Memastikan koneksi WhatsApp siap...');
  await klien.tungguSiap(60000);

  const infoSebelum = typeof klien.infoKoneksi === 'function' ? klien.infoKoneksi() : {};
  const akun = infoSebelum.nomor || null;

  // Tentukan tujuan: nomor yang diminta, atau nomor akun sendiri.
  const tujuanMentah = tujuan && String(tujuan).trim() !== '' ? tujuan : akun;
  if (!tujuanMentah) {
    throw new Error('Nomor tujuan tidak diketahui. Tautkan akun WhatsApp terlebih dahulu.');
  }

  const tujuanNormal = normalisasiNomor(tujuanMentah);
  if (!tujuanNormal.ok) throw new Error(`Nomor tujuan tidak valid: ${tujuanNormal.error}`);

  const jidTujuan = tujuanNormal.jid;
  const retrySebelum = Number(infoSebelum.retryDilayani) || 0;

  spinner.text = `Mengirim pesan uji ke ${tujuanNormal.nomor}...`;
  const isi = render(pesanUji, susunDataPenerima({ nomor: tujuanNormal.nomor, nama: 'Diagnosa', jid: jidTujuan }, 0, 1));
  const terkirim = await klien.kirim(jidTujuan, { text: isi });
  const idPesan = terkirim?.key?.id ?? null;

  // Pantau status pengiriman.
  spinner.text = 'Menunggu status pengiriman (ack)...';
  const hasilStatus = typeof klien.tungguStatus === 'function'
    ? await klien.tungguStatus(idPesan, {
        timeoutMs,
        statusTarget: STATUS_ACK_TUNTAS,
        onStatus: (entri) => {
          spinner.text = `Status: ${labelStatusAck(entri.status)} — ${entri.waktuMs} ms`;
          if (typeof onStatus === 'function') onStatus(entri);
        },
      })
    : { pesanId: idPesan, dicapai: false, status: null, riwayat: [], waktuMs: 0 };

  const infoSetelah = typeof klien.infoKoneksi === 'function' ? klien.infoKoneksi() : {};
  const retryDilayani = (Number(infoSetelah.retryDilayani) || 0) - retrySebelum;
  const durasiMs = Date.now() - mulai;

  // Susun catatan/rekomendasi untuk pengguna.
  const catatan = [];

  if (hasilStatus.dicapai) {
    catatan.push(
      `Pengiriman dasar sehat: pesan mencapai perangkat tujuan (${labelStatusAkhir(hasilStatus.status)}) dalam ${formatDurasi(hasilStatus.waktuMs)}.`,
    );
  } else if (hasilStatus.status === 2) {
    catatan.push('Pesan diterima server WhatsApp, tetapi belum sampai ke perangkat tujuan. Periksa koneksi/keaktifan nomor tujuan.');
  } else if (hasilStatus.status !== null) {
    catatan.push(`Status terakhir: ${labelStatusAkhir(hasilStatus.status)}. Coba ulangi diagnosa sebentar lagi.`);
  } else {
    catatan.push('Tidak ada ack yang diterima selama pengujian. Periksa koneksi sesi — bila perlu tautkan ulang akun.');
  }

  if (retryDilayani > 0) {
    catatan.push(
      `Penerima sempat gagal mendekripsi pesan dan wabulk berhasil melayani ${retryDilayani} permintaan kirim ulang — mekanisme anti "Menunggu pesan ini" bekerja.`,
    );
  } else {
    catatan.push('Tidak ada permintaan kirim ulang (retry) dari penerima selama pengujian: pesan terdekripsi pada percobaan pertama, atau penerima belum membuka chat.');
  }

  if ((Number(infoSetelah.pesanRetryTersimpan) || 0) === 0) {
    catatan.push('Cache pesan untuk retry kosong. Pastikan pesan uji benar-benar terkirim (pesan gagal tidak masuk cache).');
  }
  if (tujuanNormal.nomor === akun) {
    catatan.push('Tujuan uji adalah nomor akun sendiri. Status READ hanya muncul bila Anda membuka chat tersebut di HP.');
  }
  catatan.push('Untuk diagnosa lebih dalam jalankan wabulk dengan log debug: WABULK_DEBUG=1 npm start');

  const hasil = {
    timestamp: new Date().toISOString(),
    tipe: 'diagnosa',
    akun,
    akunNama: infoSebelum.nama || null,
    tujuan: tujuanNormal.nomor,
    tujuanJid: jidTujuan,
    idPesan,
    tercapai: Boolean(hasilStatus.dicapai),
    statusAkhir: hasilStatus.status,
    statusAkhirTeks: labelStatusAkhir(hasilStatus.status),
    riwayatStatus: hasilStatus.riwayat || [],
    waktuMenungguMs: hasilStatus.waktuMs || 0,
    retryDilayani,
    pesanRetryTersimpan: Number(infoSetelah.pesanRetryTersimpan) || 0,
    durasiMs,
    durasi: formatDurasi(durasiMs),
    catatan,
  };

  if (simpan) {
    const catat = simpanLog('diagnosa', hasil);
    if (catat.ok) hasil.log = { nama: catat.nama, path: catat.path };
  }

  if (cetakProgres) {
    if (hasil.tercapai) {
      spinner.succeed(`Diagnosa selesai — ${labelStatusAkhir(hasil.statusAkhir)} dalam ${hasil.durasi}`);
    } else if (hasil.statusAkhir === 2) {
      spinner.warn('Diagnosa selesai — pesan diterima server, belum sampai perangkat tujuan.');
    } else {
      spinner.warn(`Diagnosa selesai tanpa ack (${hasil.durasi}).`);
    }
  }

  return hasil;
}

/** Label status untuk laporan (memakai helper bersama di utils). */
export function labelStatusAkhir(status) {
  return labelStatusAck(status);
}

/** Laporan diagnosa dalam bentuk baris teks (untuk UI). */
export function formatLaporanDiagnosa(hasil) {
  const baris = [];

  baris.push(`Akun            : ${hasil.akun || '-'}${hasil.akunNama ? ` (${hasil.akunNama})` : ''}`);
  baris.push(`Tujuan uji      : ${hasil.tujuan}`);
  baris.push(`ID pesan uji    : ${hasil.idPesan ? potong(hasil.idPesan, 30) : '-'}`);

  const statusTeks = hasil.statusAkhirTeks || 'tidak ada ack';
  baris.push(
    `Status akhir    : ${hasil.tercapai ? chalk.green(statusTeks) : chalk.yellow(statusTeks)}` +
      (hasil.waktuMenungguMs ? chalk.gray(` (setelah ${formatDurasi(hasil.waktuMenungguMs)})`) : ''),
  );

  if (Array.isArray(hasil.riwayatStatus) && hasil.riwayatStatus.length > 0) {
    baris.push('');
    baris.push(chalk.bold('Riwayat status:'));
    hasil.riwayatStatus.forEach((item) => {
      baris.push(`  • ${labelStatusAck(item.status)} — ${item.waktuMs} ms`);
    });
  }

  baris.push('');
  baris.push(`Retry dilayani  : ${hasil.retryDilayani}`);
  baris.push(`Pesan di cache  : ${hasil.pesanRetryTersimpan}`);
  baris.push(`Total durasi    : ${hasil.durasi}`);
  if (hasil.log) baris.push(`Log             : logs/${hasil.log.nama}`);

  if (Array.isArray(hasil.catatan) && hasil.catatan.length > 0) {
    baris.push('');
    baris.push(chalk.bold('Catatan & rekomendasi:'));
    hasil.catatan.forEach((pesan) => baris.push(`  • ${pesan}`));
  }

  return baris;
}
