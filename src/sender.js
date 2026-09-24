/**
 * sender.js — inti proses bulk: loop nomor, jeda batch, jeda acak,
 * integrasi template + media + dry run + proxy + logger + progress bar.
 */
import chalk from 'chalk';
import ora from 'ora';
import {
  angkaAcak,
  buatSinyal,
  cekSinyal,
  delay,
  formatDurasi,
  formatHitungMundur,
  isDibatalkan,
  potong,
} from './utils.js';
import { render, susunDataPenerima, validasiTemplate } from './template.js';
import { bangunIsiMedia } from './media.js';
import { buatRotator, ringkasProxy } from './proxy.js';
import { simpanLog } from './logger.js';
import { spinnerSenyap, validasiDenganProgress } from './dryrun.js';

/**
 * Jeda antar batch dengan hitung mundur (bisa dibatalkan).
 * @param {number} menit
 * @param {{onTick?: Function, sinyal?: object}} opsi
 */
export async function jedaBatch(menit, opsi = {}) {
  const { onTick = null, sinyal = null } = opsi;
  const totalDetik = Math.max(0, Math.round(Number(menit) * 60));
  if (totalDetik === 0) return;

  for (let sisa = totalDetik; sisa > 0; sisa -= 1) {
    cekSinyal(sinyal);
    if (onTick) onTick(sisa, totalDetik);
    await delay(1000);
  }
}

/** Buat teks progres singkat. */
function teksProgres(batchKe, totalBatch, index, total, terkirim, gagal, nomor) {
  return (
    `Batch ${batchKe}/${totalBatch} • ${index}/${total} • ` +
    `${chalk.green(`✔ ${terkirim}`)} ${chalk.red(`✖ ${gagal}`)} • ${potong(nomor, 18)}`
  );
}

/**
 * Jalankan proses bulk.
 *
 * @param {object} opsi
 * @param {object} opsi.klien          instance KlienWhatsApp (atau objek dengan `.sock`)
 * @param {Array}  opsi.daftar         daftar penerima hasil parsing
 * @param {string} opsi.teks           template pesan teks
 * @param {null|{path: string, tipe?: string, caption?: string}} opsi.media
 * @param {object} opsi.config         konfigurasi wabulk
 * @param {string} [opsi.sumber]       label sumber nomor untuk log
 * @param {string} [opsi.tipePesan]    'teks' | 'gambar' | 'video' | 'dokumen'
 * @param {object} [opsi.sinyal]       token pembatalan
 * @param {boolean} [opsi.cetakProgres] tampilkan spinner ora
 * @param {boolean} [opsi.simpan]      simpan log ke logs/
 * @param {Function} [opsi.rotasiProxy] callback async (proxyUrl) untuk ganti proxy
 * @returns {Promise<object>} ringkasan hasil
 */
export async function jalankanBulk(opsi = {}) {
  const {
    klien,
    daftar = [],
    teks = '',
    media = null,
    config = {},
    sumber = '-',
    tipePesan = 'teks',
    sinyal = buatSinyal(),
    cetakProgres = true,
    simpan = true,
    rotasiProxy = null,
    onStatus = () => {},
  } = opsi;

  if (!klien) throw new Error('Tidak ada koneksi WhatsApp. Tautkan akun terlebih dahulu.');
  if (!Array.isArray(daftar) || daftar.length === 0) throw new Error('Daftar nomor kosong.');

  const perBatch = Math.max(1, Number(config.perBatch) || 15);
  const jedaMenit = Math.max(0, Number(config.jeda) || 0);
  const jedaMin = Math.max(0, Number(config.jedaMin) || 0);
  const jedaMax = Math.max(jedaMin, Number(config.jedaMax) || jedaMin);

  const pakaiMedia = Boolean(media && media.path);
  if (!pakaiMedia && !String(teks).trim()) throw new Error('Isi pesan kosong.');

  // Validasi template (peringatan saja, tidak menghentikan proses).
  const periksa = validasiTemplate(pakaiMedia ? media.caption || '' : teks);
  if (periksa.peringatan.length > 0) {
    periksa.peringatan.forEach((pesan) => onStatus({ level: 'peringatan', pesan }));
  }

  // Siapkan isi media sekali saja (Buffer dibaca dari disk).
  let mediaBase = null;
  let infoMedia = null;
  if (pakaiMedia) {
    const hasilMedia = await bangunIsiMedia({ filePath: media.path, tipe: media.tipe ?? null, caption: '' });
    if (!hasilMedia.ok) throw new Error(hasilMedia.error);
    mediaBase = hasilMedia.isi;
    infoMedia = hasilMedia.info;
  }

  const spinner = cetakProgres ? ora() : spinnerSenyap();
  const mulai = Date.now();

  // --- Tahap 1: validasi nomor (bila dryRun aktif) -------------------------
  let siapKirim = daftar;
  let hasilValidasi = null;
  if (config.dryRun && !opsi.sudahValidasi) {
    onStatus({ level: 'info', pesan: 'Mode validasi aktif: memeriksa nomor sebelum mengirim...' });
    hasilValidasi = await validasiDenganProgress(klien.sock ?? null, daftar, { sinyal, cetakProgres });
    siapKirim = hasilValidasi.siapKirim;
    if (siapKirim.length === 0) {
      throw new Error('Tidak ada nomor valid yang bisa dikirimi pesan. Proses dihentikan.');
    }
  }

  const total = siapKirim.length;
  const totalBatch = Math.ceil(total / perBatch);
  const rotator = buatRotator(config.proxy);

  const detail = [];
  let terkirim = 0;
  let gagal = 0;
  let dibatalkan = false;

  // Pramuat sesi enkripsi (sekali per JID) supaya pesan pertama ke sebuah
  // nomor tidak gagal didekripsi di sisi penerima.
  const pakaiPramuat = config.prewarmSesi !== false;
  const sudahDipramuat = new Set();

  // Adapter agar sender bisa dipakai dengan KlienWhatsApp maupun socket mentah.
  const kirim = typeof klien.kirim === 'function'
    ? (jid, isi) => klien.kirim(jid, isi)
    : (jid, isi) => klien.sock.sendMessage(jid, isi);
  const tungguSiap = typeof klien.tungguSiap === 'function' ? (ms) => klien.tungguSiap(ms) : async () => klien.sock;
  const tersambung = () => (typeof klien.tersambung === 'boolean' ? klien.tersambung : true);

  spinner.start('Menyiapkan pengiriman...');

  try {
    for (let index = 0; index < total; index += 1) {
      cekSinyal(sinyal);

      const item = siapKirim[index];
      const batchKe = Math.floor(index / perBatch) + 1;
      const posisiDalamBatch = index % perBatch;

      // Awal batch baru (bukan batch pertama): rotasi proxy + jeda antar batch.
      if (posisiDalamBatch === 0 && index > 0) {
        if (rotator && config.proxy?.rotatePerBatch && typeof rotasiProxy === 'function') {
          const proxyBaru = rotator.ambilUntukBatch(Math.floor(index / perBatch));
          if (proxyBaru) {
            spinner.stopAndPersist({
              symbol: chalk.cyan('⇄'),
              text: `Beralih proxy → ${ringkasProxy(proxyBaru)}`,
            });
            try {
              await rotasiProxy(proxyBaru);
            } catch (error) {
              spinner.stopAndPersist({
                symbol: chalk.yellow('⚠'),
                text: `Gagal beralih proxy (${error.message}). Lanjut dengan proxy sebelumnya.`,
              });
            }
            spinner.start();
          }
        }

        spinner.text = `Jeda antar batch: ${formatHitungMundur(jedaMenit * 60)}`;
        await jedaBatch(jedaMenit, {
          sinyal,
          onTick: (sisa) => {
            spinner.text = `Jeda antar batch: ${formatHitungMundur(sisa)} (lanjut otomatis)`;
          },
        });
        spinner.start(teksProgres(batchKe, totalBatch, index, total, terkirim, gagal, item.nomor));
      }

      spinner.text = teksProgres(batchKe, totalBatch, index + 1, total, terkirim, gagal, item.nomor);

      // Pramuat sesi enkripsi untuk penerima ini (sekali saja per sesi bulk).
      if (pakaiPramuat && typeof klien.siapkanSesi === 'function' && !sudahDipramuat.has(item.jid)) {
        sudahDipramuat.add(item.jid);
        spinner.text = `Menyiapkan sesi enkripsi → ${potong(item.nomor, 18)}`;
        try {
          await klien.siapkanSesi(item.jid);
        } catch (error) {
          onStatus({
            level: 'peringatan',
            pesan: `Pramuat sesi gagal untuk ${item.nomor} (${error.message}). Pesan tetap dicoba dikirim.`,
          });
        }
      }

      // Susun isi pesan untuk penerima ini.
      const data = susunDataPenerima(item, index, total);
      let isi;
      if (pakaiMedia) {
        isi = { ...mediaBase };
        const caption = render(media.caption || '', data).trim();
        if (caption) isi.caption = caption;
        else delete isi.caption;
      } else {
        isi = { text: render(teks, data) };
      }

      // Kirim dengan 1x percobaan ulang bila koneksi sempat putus.
      let sukses = false;
      let pesanError = null;
      for (let percobaan = 1; percobaan <= 2 && !sukses; percobaan += 1) {
        try {
          if (!tersambung()) {
            spinner.text = 'Koneksi terputus — menunggu sambung ulang...';
            await tungguSiap(120000);
          }
          await kirim(item.jid, isi);
          sukses = true;
        } catch (error) {
          pesanError = error?.message || String(error);
          if (percobaan === 1) await delay(2000);
        }
      }

      if (sukses) {
        terkirim += 1;
        detail.push({
          nomor: item.nomor,
          nama: item.nama || '',
          jid: item.jid,
          status: 'sent',
          waktu: new Date().toISOString(),
        });
      } else {
        gagal += 1;
        detail.push({
          nomor: item.nomor,
          nama: item.nama || '',
          jid: item.jid,
          status: 'failed',
          error: pesanError || 'tidak diketahui',
          waktu: new Date().toISOString(),
        });
        spinner.stopAndPersist({
          symbol: chalk.red('✖'),
          text: `Gagal ${item.nomor}: ${potong(pesanError, 60)}`,
        });
        spinner.start(teksProgres(batchKe, totalBatch, index + 1, total, terkirim, gagal, item.nomor));
      }

      const nomorTerakhir = index === total - 1;
      const akhirBatch = posisiDalamBatch === perBatch - 1;

      // Jeda acak antar nomor (tetap terlihat manusiawi).
      if (!nomorTerakhir && !akhirBatch) {
        const jedaDetik = angkaAcak(jedaMin, jedaMax);
        for (let sisa = jedaDetik; sisa > 0; sisa -= 1) {
          cekSinyal(sinyal);
          spinner.text = `${teksProgres(batchKe, totalBatch, index + 1, total, terkirim, gagal, item.nomor)} • jeda ${sisa}s`;
          await delay(1000);
        }
      }
    }
  } catch (error) {
    if (isDibatalkan(error)) {
      dibatalkan = true;
    } else {
      spinner.fail(`Pengiriman terhenti: ${error.message}`);
      throw error;
    }
  }

  const durasiMs = Date.now() - mulai;
  const hasil = {
    timestamp: new Date().toISOString(),
    tipe: 'bulk',
    sumber,
    tipePesan: pakaiMedia ? tipePesan : 'teks',
    media: infoMedia ? infoMedia.path : null,
    totalDiminta: daftar.length,
    total,
    terkirim,
    gagal,
    perBatch,
    jeda: jedaMenit,
    jedaMin,
    jedaMax,
    prewarmSesi: pakaiPramuat,
    durasi: formatDurasi(durasiMs),
    durasiMs,
    dibatalkan,
    detail,
  };

  if (hasilValidasi) {
    hasil.validasi = {
      valid: hasilValidasi.valid.length,
      tidakValid: hasilValidasi.tidakValid.length,
      grup: hasilValidasi.grup.length,
    };
  }

  if (simpan) {
    const catat = simpanLog('bulk', hasil);
    if (catat.ok) hasil.log = { nama: catat.nama, path: catat.path };
  }

  if (dibatalkan) {
    spinner.warn(`Dihentikan oleh pengguna. ${terkirim} terkirim, ${gagal} gagal (${formatDurasi(durasiMs)}).`);
  } else {
    spinner.succeed(
      `Selesai: ${chalk.green(`${terkirim} terkirim`)}, ${chalk.red(`${gagal} gagal`)} dari ${total} nomor • ${formatDurasi(durasiMs)}`,
    );
  }

  return hasil;
}

/** Ringkasan hasil bulk dalam bentuk baris teks (untuk UI). */
export function ringkasHasil(hasil) {
  const baris = [];
  const persen = hasil.total > 0 ? Math.round((hasil.terkirim / hasil.total) * 100) : 0;

  baris.push(`Total diproses : ${hasil.total}${hasil.totalDiminta > hasil.total ? ` (dari ${hasil.totalDiminta} nomor)` : ''}`);
  baris.push(chalk.green(`Terkirim       : ${hasil.terkirim}`));
  baris.push(chalk.red(`Gagal          : ${hasil.gagal}`));
  baris.push(`Keberhasilan   : ${persen}%`);
  baris.push(`Durasi         : ${hasil.durasi}`);
  if (hasil.dibatalkan) baris.push(chalk.yellow('Catatan        : dihentikan lebih awal oleh pengguna'));
  if (hasil.log) baris.push(`Log tersimpan  : ${hasil.log.nama}`);

  const gagalDetail = (hasil.detail || []).filter((item) => item.status === 'failed').slice(0, 10);
  if (gagalDetail.length > 0) {
    baris.push('');
    baris.push(chalk.bold('Contoh kegagalan:'));
    gagalDetail.forEach((item) => {
      baris.push(`  ${chalk.red('✖')} ${item.nomor} — ${item.error}`);
    });
  }

  return baris;
}

/** Label tipe pesan untuk ditampilkan. */
export const LABEL_TIPE_PESAN = Object.freeze({
  teks: 'Teks',
  gambar: 'Gambar',
  video: 'Video',
  dokumen: 'Dokumen',
});
