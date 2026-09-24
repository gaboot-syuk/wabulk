/**
 * ui.js — seluruh menu interaktif wabulk (berbahasa Indonesia).
 *
 * Alur menu:
 *   Menu Utama
 *   ├── Tautkan Akun WhatsApp (QR / pairing code / logout)
 *   ├── Mulai Bulk Pesan
 *   ├── Mode Dry Run (validasi nomor)
 *   ├── Pengaturan (termasuk proxy)
 *   ├── Lihat Riwayat
 *   ├── Bantuan & Disclaimer
 *   └── Keluar
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import prompts from 'prompts';
import qrcode from 'qrcode-terminal';

import {
  AUTH_DIR,
  EXAMPLES_DIR,
  KeluarError,
  LOGS_DIR,
  NAMA_APP,
  ROOT_DIR,
  SETTINGS_PATH,
  VERSI_APP,
  bacaFileNomor,
  bersihkanDuplikat,
  buatSinyal,
  delay,
  isDibatalkan,
  parseInputManual,
  potong,
  salamWaktu,
} from './utils.js';
import {
  BATAS,
  KUNCI_BOOLEAN,
  LABEL,
  PERTANYAAN_BOOLEAN,
  URUTAN_KUNCI,
  configUntukTampilan,
  loadConfig,
  resetConfig,
  ringkasConfig,
  saveConfig,
} from './config.js';
import { KlienWhatsApp, adaSessionTersimpan, hapusSessionTersimpan, infoSessionTersimpan } from './auth.js';
import { formatLaporan, simpanHasilDryRun, validasiDenganProgress } from './dryrun.js';
import { formatLaporanDiagnosa, jalankanDiagnosa } from './diagnosa.js';
import {
  KATEGORI_MEDIA,
  daftarEkstensi,
  periksaMedia,
  ringkasMedia,
} from './media.js';
import { LABEL_TIPE_PESAN, jalankanBulk, ringkasHasil } from './sender.js';
import { bacaLog, bersihkanLogLama, daftarLog, detailLog, ringkasLog, statistikLog } from './logger.js';
import { daftarProxyTampil, parseProxy, ringkasKonfigurasiProxy } from './proxy.js';
import { adaSpintax, contohVariasi, rapikanPesan, render, validasiTemplate } from './template.js';

// ---------------------------------------------------------------------------
// Utilitas input
// ---------------------------------------------------------------------------

/** Ubah path pengguna (~/x, ./x) menjadi path absolut. */
function perluasPath(teks) {
  let nilai = String(teks ?? '').trim();
  if (!nilai) return '';
  if (nilai === '~') nilai = os.homedir();
  else if (nilai.startsWith('~/')) nilai = path.join(os.homedir(), nilai.slice(2));
  return path.resolve(nilai);
}

/** Pembungkus prompts: Ctrl+C / Esc dianggap sebagai "keluar". */
async function tanya(pertanyaan) {
  const opsi = { onCancel: () => { throw new KeluarError(); } };
  return prompts(pertanyaan, opsi);
}

/** Tekan Enter untuk lanjut (Ctrl+C diabaikan). */
async function tungguEnter(pesan = 'Tekan Enter untuk kembali ke menu...') {
  try {
    await tanya({ type: 'text', name: 'lanjut', message: pesan });
  } catch (error) {
    if (!isDibatalkan(error)) throw error;
  }
}

/** Garis pemisah. */
function garis(karakter = '─', panjang = 60) {
  return chalk.gray(karakter.repeat(panjang));
}

/** Cetak daftar baris dengan indentasi. */
function cetakBaris(daftar = [], indentasi = '  ') {
  daftar.forEach((baris) => console.log(`${indentasi}${baris}`));
}

// ---------------------------------------------------------------------------
// Tampilan pembuka
// ---------------------------------------------------------------------------

/** Banner + peringatan risiko. */
export function tampilkanBanner() {
  const judul = `${NAMA_APP} v${VERSI_APP}`;
  const lebar = judul.length + 4; // 2 spasi padding di kiri & kanan
  console.log('');
  console.log(chalk.bold.cyan(`  ╭${'─'.repeat(lebar)}╮`));
  console.log(chalk.bold.cyan('  │  ') + chalk.bold.white(judul) + chalk.bold.cyan('  │'));
  console.log(chalk.bold.cyan(`  ╰${'─'.repeat(lebar)}╯`));
  console.log(chalk.gray('  CLI bulk pesan WhatsApp (Baileys) untuk testing & pembelajaran.'));
  console.log('');
  console.log(chalk.yellow('  ⚠ PERINGATAN'));
  console.log(chalk.yellow('    Bulking via library tidak resmi MELANGGAR Ketentuan Layanan WhatsApp.'));
  console.log(chalk.yellow('    Nomor Anda bisa diblokir PERMANEN tanpa jalur banding.'));
  console.log(chalk.yellow('    Gunakan hanya nomor sekali pakai dan untuk keperluan uji coba.'));
  console.log('');
}

/** Printer status koneksi (dipakai sebagai callback KlienWhatsApp). */
function buatPrinterStatus() {
  let pesanTerakhir = '';
  return (info = {}) => {
    if (!info.pesan) return;
    if (info.pesan === pesanTerakhir) return; // hindari spam pesan sama
    pesanTerakhir = info.pesan;

    let simbol = chalk.cyan('ℹ');
    if (info.status === 'terbuka') simbol = chalk.green('✔');
    else if (info.status === 'terputus' || info.status === 'galat') simbol = chalk.red('✖');
    else if (info.status === 'menyambungkan') simbol = chalk.yellow('⟳');

    console.log(`${simbol} ${info.pesan}`);
  };
}

/** Tampilkan QR code di terminal. */
function tampilkanQr(qr) {
  console.log('');
  console.log(chalk.cyan('  Scan QR berikut dengan WhatsApp Anda:'));
  console.log(chalk.gray('  WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat'));
  console.log('');
  qrcode.generate(qr, { small: true });
}

// ---------------------------------------------------------------------------
// Autentikasi
// ---------------------------------------------------------------------------

/** Alur "Tautkan Akun WhatsApp". */
async function alurTautkan(dunia) {
  console.log('');
  console.log(chalk.bold('  Tautkan Akun WhatsApp'));

  const info = infoSessionTersimpan();
  if (info.ada) {
    console.log(chalk.gray(`  Sesi tersimpan: ${AUTH_DIR}`));
    if (info.diubahPada) console.log(chalk.gray(`  Terakhir diperbarui: ${info.diubahPada}`));
  } else {
    console.log(chalk.yellow('  Belum ada sesi tersimpan.'));
  }
  console.log('');

  const { metode } = await tanya({
    type: 'select',
    name: 'metode',
    message: 'Pilih metode:',
    choices: [
      { title: 'QR Code (scan dari HP)', value: 'qr' },
      { title: 'Pairing Code (8 digit)', value: 'pairing' },
      { title: 'Logout & hapus sesi tersimpan', value: 'logout' },
      { title: '← Kembali', value: 'kembali' },
    ],
  });

  if (!metode || metode === 'kembali') return;

  if (metode === 'logout') {
    const { yakin } = await tanya({
      type: 'confirm',
      name: 'yakin',
      message: 'Hapus sesi sekarang? Anda harus scan ulang untuk memakai wabulk.',
      initial: false,
    });
    if (!yakin) {
      console.log(chalk.gray('  Dibatalkan — sesi tetap aman.'));
      return;
    }
    try {
      if (dunia.klien.tersambung) await dunia.klien.logout();
      else hapusSessionTersimpan();
      console.log(chalk.green('  ✔ Sesi dihapus. Silakan tautkan ulang kapan saja.'));
    } catch (error) {
      console.log(chalk.red(`  ✖ Gagal logout: ${error.message}`));
    }
    return;
  }

  dunia.tampilkanQr = true;

  if (dunia.klien.tersambung) {
    console.log(chalk.green('  ✔ Sudah tersambung ke WhatsApp.'));
    return;
  }

  try {
    if (metode === 'qr') {
      if (info.ada) {
        console.log(chalk.cyan('  Sesi tersimpan ditemukan — menyambung otomatis...'));
      }
      await dunia.klien.sambungkan({ metode: 'qr' });
    } else {
      const { nomor } = await tanya({
        type: 'text',
        name: 'nomor',
        message: 'Nomor WhatsApp yang akan ditautkan (contoh: 08123456789):',
        validate: (nilai) => {
          const bersih = String(nilai ?? '').replace(/[^\d]/g, '');
          if (bersih.length < 9) return 'Nomor terlalu pendek. Contoh: 08123456789';
          if (bersih.length > 15) return 'Nomor terlalu panjang.';
          return true;
        },
      });

      console.log(chalk.cyan('\n  Meminta kode pairing dari WhatsApp...'));
      await dunia.klien.sambungkan({ metode: 'pairing', nomorTelepon: nomor });
    }

    console.log(chalk.green('\n  ✔ Berhasil tersambung ke WhatsApp!'));
    console.log(chalk.gray('  Session tersimpan di auth_info/ — tidak perlu scan ulang lain kali.\n'));
  } catch (error) {
    if (isDibatalkan(error)) throw error;
    console.log(chalk.red(`\n  ✖ Gagal menyambungkan: ${error.message}\n`));
  } finally {
    dunia.tampilkanQr = false;
  }
}

/** Pastikan ada koneksi aktif sebelum menjalankan aksi (auto-connect bila perlu). */
async function pastikanTersambung(dunia, { diam = false } = {}) {
  if (dunia.klien.tersambung) return true;

  if (!adaSessionTersimpan()) {
    if (!diam) console.log(chalk.yellow('  Belum ada sesi. Tautkan akun WhatsApp terlebih dahulu.'));
    const { tautkan } = await tanya({
      type: 'confirm',
      name: 'tautkan',
      message: 'Tautkan akun sekarang?',
      initial: true,
    });
    if (!tautkan) return false;
    await alurTautkan(dunia);
    return dunia.klien.tersambung;
  }

  if (!diam) console.log(chalk.cyan('  Menyambung dengan sesi tersimpan...'));
  dunia.tampilkanQr = true;
  try {
    await dunia.klien.sambungkan({ metode: 'qr', timeoutMs: 120000 });
    if (!diam) console.log(chalk.green('  ✔ Tersambung.'));
    return true;
  } catch (error) {
    if (isDibatalkan(error)) throw error;
    if (!diam) console.log(chalk.red(`  ✖ Gagal menyambung: ${error.message}`));
    return false;
  } finally {
    dunia.tampilkanQr = false;
  }
}

// ---------------------------------------------------------------------------
// Sumber nomor
// ---------------------------------------------------------------------------

/** Tanya pesan teks multi-baris. */
async function tanyaPesanTeks() {
  console.log(chalk.gray('  Tulis pesan baris demi baris. Baris kosong = selesai.'));
  console.log(chalk.gray('  Dukungan: {{nama}} untuk personalisasi, {Halo|Hai} untuk variasi.'));
  const baris = [];

  for (;;) {
    const { nilai } = await tanya({
      type: 'text',
      name: 'nilai',
      message: baris.length === 0 ? 'Pesan:' : `Baris ${baris.length + 1}:`,
    });
    const teks = String(nilai ?? '').trim();
    if (!teks) {
      if (baris.length === 0) {
        console.log(chalk.yellow('  Pesan masih kosong. Tulis minimal satu baris.'));
        continue;
      }
      break;
    }
    baris.push(nilai);
  }

  return rapikanPesan(baris.join('\n'));
}

/** Tanya daftar nomor manual (satu entri per baris). */
async function tanyaNomorManual() {
  console.log(chalk.gray('  Masukkan satu nomor per baris. Format: 6281234567890 atau 6281234567890,Budi'));
  console.log(chalk.gray('  Baris kosong = selesai.'));
  const baris = [];

  for (;;) {
    const { nilai } = await tanya({
      type: 'text',
      name: 'nilai',
      message: baris.length === 0 ? 'Nomor:' : `Nomor #${baris.length + 1}:`,
    });
    const teks = String(nilai ?? '').trim();
    if (!teks) break;
    baris.push(teks);
  }

  return baris.join('\n');
}

/**
 * Minta sumber nomor (file atau manual) lalu parse.
 * @returns {Promise<null|{daftar: Array, sumber: string, dilewati: Array, duplikat: Array}>}
 */
async function pilihSumberNomor() {
  const { sumber } = await tanya({
    type: 'select',
    name: 'sumber',
    message: 'Sumber nomor:',
    choices: [
      { title: 'Dari file .txt', value: 'file' },
      { title: 'Input manual', value: 'manual' },
      { title: '← Kembali', value: 'kembali' },
    ],
  });

  if (!sumber || sumber === 'kembali') return null;

  let hasilBaca = null;

  if (sumber === 'file') {
    const contoh = path.join(EXAMPLES_DIR, 'nomor.txt');
    const { berkas } = await tanya({
      type: 'text',
      name: 'berkas',
      message: 'Path file nomor (.txt):',
      initial: fs.existsSync(contoh) ? contoh : '',
      validate: (nilai) => (String(nilai ?? '').trim() ? true : 'Path tidak boleh kosong'),
    });

    const filePath = perluasPath(berkas);
    try {
      hasilBaca = bacaFileNomor(filePath);
      hasilBaca.file = filePath;
    } catch (error) {
      console.log(chalk.red(`\n  ✖ Gagal membaca file: ${error.message}\n`));
      return null;
    }

    if (hasilBaca.daftar.length === 0) {
      console.log(chalk.red('\n  ✖ Tidak ada nomor valid di file tersebut.'));
      if (hasilBaca.dilewati.length > 0) {
        cetakBaris(hasilBaca.dilewati.slice(0, 5).map((item) => chalk.gray(`baris ${item.baris}: ${item.teks} → ${item.alasan}`)));
      }
      console.log('');
      return null;
    }
  } else {
    const teks = await tanyaNomorManual();
    hasilBaca = parseInputManual(teks);
    if (hasilBaca.daftar.length === 0) {
      console.log(chalk.yellow('\n  Tidak ada nomor yang bisa dipakai.\n'));
      return null;
    }
  }

  const { daftar, duplikat } = bersihkanDuplikat(hasilBaca.daftar);
  const label = hasilBaca.file ? `file ${path.basename(hasilBaca.file)}` : 'input manual';

  console.log('');
  console.log(`  ${chalk.green('✔')} ${daftar.length} nomor siap dipakai (${label})`);
  if (duplikat.length > 0) console.log(chalk.gray(`  • ${duplikat.length} nomor duplikat diabaikan`));
  if (hasilBaca.dilewati.length > 0) {
    console.log(chalk.yellow(`  • ${hasilBaca.dilewati.length} baris dilewati`));
    cetakBaris(hasilBaca.dilewati.slice(0, 5).map((item) => chalk.gray(`baris ${item.baris}: ${item.teks} → ${item.alasan}`)));
  }

  const adaNama = daftar.filter((item) => item.nama).length;
  if (adaNama > 0) console.log(chalk.gray(`  • ${adaNama} nomor punya nama (bisa dipakai untuk {{nama}})`));
  console.log('');

  return { daftar, sumber: label, dilewati: hasilBaca.dilewati, duplikat };
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Pilih tipe pesan (teks/media). */
async function pilihTipePesan() {
  const { tipe } = await tanya({
    type: 'select',
    name: 'tipe',
    message: 'Tipe pesan:',
    choices: [
      { title: 'Teks', value: 'teks' },
      { title: 'Gambar (.jpg, .jpeg, .png, .webp)', value: 'gambar' },
      { title: 'Video (.mp4, .mkv)', value: 'video' },
      { title: 'Dokumen (.pdf, .docx, .xlsx, .zip)', value: 'dokumen' },
      { title: '← Batal', value: 'batal' },
    ],
  });
  return tipe === 'batal' ? null : tipe;
}

/** Minta path media + caption, lalu validasi. */
async function tanyaMedia(tipePesan) {
  const info = KATEGORI_MEDIA[tipePesan];
  const { berkas } = await tanya({
    type: 'text',
    name: 'berkas',
    message: `Path berkas ${info.label.toLowerCase()} (${info.ekstensi.join(', ')}):`,
    validate: (nilai) => (String(nilai ?? '').trim() ? true : 'Path tidak boleh kosong'),
  });

  const filePath = perluasPath(berkas);
  const periksa = periksaMedia(filePath, tipePesan);
  if (!periksa.ok) {
    console.log(chalk.red(`\n  ✖ ${periksa.error}\n`));
    return null;
  }

  console.log(chalk.green(`  ✔ ${ringkasMedia(periksa)}`));

  const { caption } = await tanya({
    type: 'text',
    name: 'caption',
    message: 'Caption (opsional, boleh pakai {{nama}} / {Halo|Hai}):',
    initial: '',
  });

  return { path: periksa.path, tipe: periksa.tipe, caption: rapikanPesan(caption || ''), info: periksa };
}

// ---------------------------------------------------------------------------
// Preview & konfirmasi
// ---------------------------------------------------------------------------

/** Tampilkan preview pesan untuk beberapa penerima pertama. */
function tampilkanPreview({ teks, media, daftar, tipePesan }) {
  const contoh = daftar.slice(0, 3);

  console.log('');
  console.log(garis());
  console.log(chalk.bold('  PREVIEW PESAN'));
  console.log(garis());
  console.log(`  Tipe pesan : ${LABEL_TIPE_PESAN[tipePesan] || tipePesan}`);
  if (media) console.log(`  Berkas     : ${ringkasMedia(media.info)}`);
  console.log('');

  if (tipePesan === 'teks') {
    contoh.forEach((item, index) => {
      const hasil = render(teks, {
        nomor: item.nomor,
        nama: item.nama || '',
        jid: item.jid,
        index: index + 1,
        total: daftar.length,
      });
      console.log(chalk.gray(`  → Ke ${item.nomor}${item.nama ? ` (${item.nama})` : ''}:`));
      hasil.split('\n').forEach((baris) => console.log(`    ${baris}`));
      console.log('');
    });
  } else {
    const caption = media?.caption || '';
    if (!caption) {
      console.log(chalk.gray('  (tanpa caption)'));
      console.log('');
    } else {
      contoh.forEach((item, index) => {
        const hasil = render(caption, {
          nomor: item.nomor,
          nama: item.nama || '',
          jid: item.jid,
          index: index + 1,
          total: daftar.length,
        });
        console.log(chalk.gray(`  → Caption ke ${item.nomor}:`));
        hasil.split('\n').forEach((baris) => console.log(`    ${baris}`));
        console.log('');
      });
    }
  }

  // Contoh variasi spintax (bila ada)
  const sumberSpintax = tipePesan === 'teks' ? teks : media?.caption || '';
  if (adaSpintax(sumberSpintax)) {
    console.log(chalk.gray('  Contoh variasi spintax:'));
    contohVariasi(sumberSpintax, 3).forEach((variasi) => {
      console.log(chalk.gray(`    • ${potong(variasi.replace(/\n/g, ' ⏎ '), 70)}`));
    });
    console.log('');
  }

  if (daftar.length > contoh.length) {
    console.log(chalk.gray(`  (preview hanya untuk ${contoh.length} dari ${daftar.length} penerima)`));
    console.log('');
  }
}

/** Ringkasan + konfirmasi sebelum kirim. */
async function konfirmasiKirim({ daftar, config, tipePesan, media, sumber }) {
  console.log(garis());
  console.log(chalk.bold('  RINGKASAN'));
  console.log(garis());
  console.log(`  Sumber nomor     : ${sumber}`);
  console.log(`  Jumlah penerima  : ${daftar.length}`);
  console.log(`  Tipe pesan       : ${LABEL_TIPE_PESAN[tipePesan] || tipePesan}`);
  if (media) console.log(`  Media            : ${ringkasMedia(media.info)}`);
  console.log(`  Nomor per batch  : ${config.perBatch}`);
  console.log(`  Jeda antar batch : ${config.jeda} menit`);
  console.log(`  Jeda acak        : ${config.jedaMin}-${config.jedaMax} detik`);
  console.log(`  Validasi (dry run): ${config.dryRun ? chalk.green('aktif') : 'nonaktif'}`);
  console.log(`  Pramuat sesi     : ${config.prewarmSesi !== false ? chalk.green('aktif') : 'nonaktif'}`);
  console.log(`  Proxy            : ${ringkasKonfigurasiProxy(config.proxy)}`);

  const totalMenit = Math.ceil(
    ((daftar.length * ((config.jedaMin + config.jedaMax) / 2)) / 60) +
      (Math.max(0, Math.ceil(daftar.length / config.perBatch) - 1) * config.jeda),
  );
  console.log(`  Estimasi durasi  : sekitar ${totalMenit} menit`);
  console.log(garis());
  console.log('');

  const { lanjut } = await tanya({
    type: 'confirm',
    name: 'lanjut',
    message: 'Mulai kirim sekarang?',
    initial: true,
  });

  return Boolean(lanjut);
}

// ---------------------------------------------------------------------------
// Alur utama fitur
// ---------------------------------------------------------------------------

/** Alur "Mulai Bulk Pesan". */
async function alurBulk(dunia) {
  console.log('');
  console.log(chalk.bold('  Mulai Bulk Pesan'));
  console.log('');

  const sumber = await pilihSumberNomor();
  if (!sumber) return;

  const tipePesan = await pilihTipePesan();
  if (!tipePesan) return;

  let teks = '';
  let media = null;

  if (tipePesan === 'teks') {
    teks = await tanyaPesanTeks();
    if (!teks.trim()) {
      console.log(chalk.yellow('  Pesan kosong, dibatalkan.'));
      return;
    }
    const periksa = validasiTemplate(teks);
    periksa.peringatan.forEach((pesan) => console.log(chalk.yellow(`  ⚠ ${pesan}`)));
  } else {
    media = await tanyaMedia(tipePesan);
    if (!media) return;
  }

  tampilkanPreview({ teks, media, daftar: sumber.daftar, tipePesan });

  const lanjut = await konfirmasiKirim({
    daftar: sumber.daftar,
    config: dunia.config,
    tipePesan,
    media,
    sumber: sumber.sumber,
  });
  if (!lanjut) {
    console.log(chalk.gray('  Dibatalkan.\n'));
    return;
  }

  if (!(await pastikanTersambung(dunia))) {
    console.log(chalk.red('  ✖ Tidak ada koneksi WhatsApp. Proses dibatalkan.\n'));
    return;
  }

  let daftarKirim = sumber.daftar;
  let sudahValidasi = false;

  // Tahap validasi opsional (dry run) sebelum benar-benar mengirim.
  if (dunia.config.dryRun) {
    console.log('');
    try {
      const hasilValidasi = await validasiDenganProgress(dunia.klien.sock, sumber.daftar, {
        sinyal: dunia.sinyal,
      });
      cetakBaris(formatLaporan(hasilValidasi));
      console.log('');
      simpanHasilDryRun(hasilValidasi, { sumber: sumber.sumber });

      if (hasilValidasi.siapKirim.length === 0) {
        console.log(chalk.red('  ✖ Tidak ada nomor valid. Proses dihentikan.\n'));
        return;
      }

      const { kirimSaja } = await tanya({
        type: 'confirm',
        name: 'kirimSaja',
        message: `Lanjut kirim ke ${hasilValidasi.siapKirim.length} nomor valid?`,
        initial: true,
      });
      if (!kirimSaja) {
        console.log(chalk.gray('  Dibatalkan. Hasil validasi sudah disimpan di logs/.\n'));
        return;
      }

      daftarKirim = hasilValidasi.siapKirim;
      sudahValidasi = true;
    } catch (error) {
      if (isDibatalkan(error)) throw error;
      console.log(chalk.red(`  ✖ Validasi gagal: ${error.message}\n`));
      return;
    }
  }

  dunia.sinyal = buatSinyal();
  console.log('');

  try {
    const hasil = await jalankanBulk({
      klien: dunia.klien,
      daftar: daftarKirim,
      teks,
      media,
      config: dunia.config,
      sumber: sumber.sumber,
      tipePesan,
      sinyal: dunia.sinyal,
      sudahValidasi,
      onStatus: (info) => {
        if (info.level === 'peringatan') console.log(chalk.yellow(`  ⚠ ${info.pesan}`));
      },
      rotasiProxy: async (proxyUrl) => {
        await dunia.klien.gantiProxy(proxyUrl);
      },
    });

    console.log('');
    console.log(garis());
    console.log(chalk.bold('  HASIL AKHIR'));
    console.log(garis());
    cetakBaris(ringkasHasil(hasil));
    console.log(garis());
    console.log('');
    await tungguEnter();
  } catch (error) {
    if (isDibatalkan(error)) {
      console.log(chalk.yellow('\n  Pengiriman dihentikan. Log sebagian sudah disimpan.\n'));
      return;
    }
    console.log(chalk.red(`\n  ✖ Pengiriman gagal: ${error.message}\n`));
  }
}

/** Alur "Mode Dry Run": hanya validasi nomor. */
async function alurDryRun(dunia) {
  console.log('');
  console.log(chalk.bold('  Mode Dry Run — validasi nomor tanpa mengirim pesan'));
  console.log('');

  const sumber = await pilihSumberNomor();
  if (!sumber) return;

  if (!(await pastikanTersambung(dunia))) {
    console.log(chalk.red('  ✖ Tidak ada koneksi WhatsApp. Validasi dibatalkan.\n'));
    return;
  }

  console.log('');
  try {
    const hasil = await validasiDenganProgress(dunia.klien.sock, sumber.daftar, {
      sinyal: dunia.sinyal,
    });

    console.log('');
    cetakBaris(formatLaporan(hasil));

    const simpan = simpanHasilDryRun(hasil, { sumber: sumber.sumber });
    console.log('');
    console.log(
      simpan.ok
        ? chalk.green(`  ✔ Hasil validasi disimpan: logs/${simpan.nama}`)
        : chalk.yellow(`  ⚠ ${simpan.error}`),
    );
    console.log('');
  } catch (error) {
    if (isDibatalkan(error)) {
      console.log(chalk.yellow('\n  Validasi dibatalkan.\n'));
      return;
    }
    console.log(chalk.red(`\n  ✖ Validasi gagal: ${error.message}\n`));
    return;
  }

  await tungguEnter();
}

/** Alur "Cek Kesehatan Pengiriman" (diagnosa pengiriman). */
async function alurDiagnosa(dunia) {
  console.log('');
  console.log(chalk.bold('  Cek Kesehatan Pengiriman (diagnosa)'));
  console.log(chalk.gray('  Mengirim 1 pesan uji lalu memantau status pengirimannya (ack).'));
  console.log('');

  if (!(await pastikanTersambung(dunia))) {
    console.log(chalk.red('  ✖ Tidak ada koneksi WhatsApp. Diagnosa dibatalkan.\n'));
    return;
  }

  const akun = dunia.klien.nomorSaya;
  const info = typeof dunia.klien.infoKoneksi === 'function' ? dunia.klien.infoKoneksi() : {};
  console.log(`  Akun aktif      : ${akun || '-'}${info.nama ? ` (${info.nama})` : ''}`);
  console.log(`  Pesan di cache  : ${info.pesanRetryTersimpan ?? 0}`);
  console.log(`  Retry dilayani  : ${info.retryDilayani ?? 0}`);
  console.log('');

  const { tujuan } = await tanya({
    type: 'text',
    name: 'tujuan',
    message: `Nomor tujuan uji${akun ? ` (kosongkan = ${akun})` : ''}:`,
    initial: '',
  });

  const tujuanBersih = String(tujuan ?? '').trim();
  const { lanjut } = await tanya({
    type: 'confirm',
    name: 'lanjut',
    message: `Kirim pesan uji ke ${tujuanBersih || akun || '-'}?`,
    initial: true,
  });
  if (!lanjut) {
    console.log(chalk.gray('  Dibatalkan.\n'));
    return;
  }

  console.log('');
  try {
    const hasil = await jalankanDiagnosa({
      klien: dunia.klien,
      tujuan: tujuanBersih || null,
    });

    console.log('');
    console.log(garis());
    console.log(chalk.bold('  HASIL DIAGNOSA'));
    console.log(garis());
    cetakBaris(formatLaporanDiagnosa(hasil));
    console.log(garis());
    console.log('');
  } catch (error) {
    if (isDibatalkan(error)) {
      console.log(chalk.yellow('\n  Diagnosa dibatalkan.\n'));
      return;
    }
    console.log(chalk.red(`\n  ✖ Diagnosa gagal: ${error.message}\n`));
    return;
  }

  await tungguEnter();
}

/** Nilai pengaturan dalam bentuk teks untuk ditampilkan di menu. */
function nilaiPengaturan(config, kunci) {
  if (KUNCI_BOOLEAN.includes(kunci)) return config[kunci] ? 'aktif' : 'nonaktif';
  if (kunci === 'proxy') return ringkasKonfigurasiProxy(config.proxy);
  return String(config[kunci]);
}

/** Submenu pengaturan proxy. */
async function alurProxy(dunia) {
  for (;;) {
    const proxy = dunia.config.proxy;
    console.log('');
    console.log(garis());
    console.log(chalk.bold('  PENGATURAN PROXY'));
    console.log(garis());
    console.log(`  Status  : ${ringkasKonfigurasiProxy(proxy)}`);
    if (proxy && Array.isArray(proxy.list)) {
      const daftar = daftarProxyTampil(proxy);
      daftar.forEach((baris) => console.log(`    ${baris}`));
    }
    console.log('');

    const { aksi } = await tanya({
      type: 'select',
      name: 'aksi',
      message: 'Kelola proxy:',
      choices: [
        { title: 'Tambah proxy', value: 'tambah' },
        { title: 'Hapus proxy', value: 'hapus' },
        { title: 'Aktif / nonaktifkan proxy', value: 'toggle' },
        { title: `Rotasi per batch: ${proxy?.rotatePerBatch !== false ? 'aktif' : 'nonaktif'}`, value: 'rotasi' },
        { title: 'Kosongkan daftar proxy', value: 'kosongkan' },
        { title: '← Kembali', value: 'kembali' },
      ],
    });

    if (!aksi || aksi === 'kembali') return;

    const daftarSekarang = Array.isArray(dunia.config.proxy?.list) ? [...dunia.config.proxy.list] : [];

    if (aksi === 'tambah') {
      const { nilai } = await tanya({
        type: 'text',
        name: 'nilai',
        message: 'Proxy baru (contoh: socks5://user:pass@127.0.0.1:1080):',
        validate: (v) => {
          const hasil = parseProxy(v);
          return hasil.ok ? true : hasil.error;
        },
      });
      const hasil = parseProxy(nilai);
      daftarSekarang.push(hasil.url);
      const simpan = saveConfig({
        ...dunia.config,
        proxy: {
          enabled: true,
          list: daftarSekarang,
          rotatePerBatch: dunia.config.proxy?.rotatePerBatch !== false,
        },
      });
      dunia.config = simpan.config;
      console.log(chalk.green(`  ✔ Proxy ditambahkan (${daftarSekarang.length} total).`));
    }

    if (aksi === 'hapus') {
      if (daftarSekarang.length === 0) {
        console.log(chalk.yellow('  Belum ada proxy untuk dihapus.'));
        continue;
      }
      const { index } = await tanya({
        type: 'select',
        name: 'index',
        message: 'Pilih proxy yang dihapus:',
        choices: [
          ...daftarSekarang.map((url, i) => ({ title: `${i + 1}. ${url}`, value: i })),
          { title: '← Batal', value: -1 },
        ],
      });
      if (index === undefined || index < 0) continue;
      daftarSekarang.splice(index, 1);
      const simpan = saveConfig({
        ...dunia.config,
        proxy:
          daftarSekarang.length === 0
            ? null
            : {
                enabled: dunia.config.proxy?.enabled !== false,
                list: daftarSekarang,
                rotatePerBatch: dunia.config.proxy?.rotatePerBatch !== false,
              },
      });
      dunia.config = simpan.config;
      console.log(chalk.green('  ✔ Proxy dihapus.'));
    }

    if (aksi === 'toggle') {
      if (daftarSekarang.length === 0) {
        console.log(chalk.yellow('  Belum ada proxy. Tambahkan dulu.'));
        continue;
      }
      const simpan = saveConfig({
        ...dunia.config,
        proxy: {
          ...dunia.config.proxy,
          list: daftarSekarang,
          enabled: dunia.config.proxy?.enabled === false,
        },
      });
      dunia.config = simpan.config;
      console.log(chalk.green(`  ✔ Proxy ${dunia.config.proxy.enabled ? 'diaktifkan' : 'dinonaktifkan'}.`));
    }

    if (aksi === 'rotasi') {
      if (daftarSekarang.length === 0) {
        console.log(chalk.yellow('  Belum ada proxy. Tambahkan dulu.'));
        continue;
      }
      const simpan = saveConfig({
        ...dunia.config,
        proxy: {
          ...dunia.config.proxy,
          list: daftarSekarang,
          rotatePerBatch: dunia.config.proxy?.rotatePerBatch === false,
        },
      });
      dunia.config = simpan.config;
      console.log(chalk.green(`  ✔ Rotasi per batch ${dunia.config.proxy.rotatePerBatch ? 'diaktifkan' : 'dimatikan'}.`));
    }

    if (aksi === 'kosongkan') {
      const { yakin } = await tanya({ type: 'confirm', name: 'yakin', message: 'Hapus semua proxy?', initial: false });
      if (!yakin) continue;
      const simpan = saveConfig({ ...dunia.config, proxy: null });
      dunia.config = simpan.config;
      console.log(chalk.green('  ✔ Daftar proxy dikosongkan.'));
    }
  }
}

/** Alur "Pengaturan". */
async function alurPengaturan(dunia) {
  for (;;) {
    console.log('');
    console.log(garis());
    console.log(chalk.bold('  PENGATURAN'));
    console.log(garis());
    cetakBaris(ringkasConfig(dunia.config));
    console.log('');

    const { pilihan } = await tanya({
      type: 'select',
      name: 'pilihan',
      message: 'Ubah pengaturan:',
      choices: [
        ...URUTAN_KUNCI.map((kunci) => ({
          title: `${LABEL[kunci]}: ${nilaiPengaturan(dunia.config, kunci)}`,
          value: kunci,
        })),
        { title: 'Tampilkan isi settings.json', value: 'lihat' },
        { title: 'Kembalikan ke default', value: 'reset' },
        { title: '← Kembali', value: 'kembali' },
      ],
    });

    if (!pilihan || pilihan === 'kembali') return;

    if (pilihan === 'lihat') {
      console.log('');
      console.log(chalk.gray(`  File: ${SETTINGS_PATH}`));
      console.log(chalk.gray(`  ${garis('·', 56)}`));
      console.log(JSON.stringify(configUntukTampilan(dunia.config), null, 2).split('\n').map((b) => `  ${b}`).join('\n'));
      console.log('');
      await tungguEnter();
      continue;
    }

    if (pilihan === 'reset') {
      const { yakin } = await tanya({ type: 'confirm', name: 'yakin', message: 'Kembalikan semua pengaturan ke default?', initial: false });
      if (!yakin) continue;
      const hasil = resetConfig();
      dunia.config = loadConfig().config;
      console.log(chalk.green(`  ✔ ${hasil.pesan}`));
      continue;
    }

    if (pilihan === 'proxy') {
      await alurProxy(dunia);
      continue;
    }

    if (KUNCI_BOOLEAN.includes(pilihan)) {
      const { aktif } = await tanya({
        type: 'confirm',
        name: 'aktif',
        message: PERTANYAAN_BOOLEAN[pilihan] || `Aktifkan ${LABEL[pilihan]}?`,
        initial: Boolean(dunia.config[pilihan]),
      });
      const simpan = saveConfig({ ...dunia.config, [pilihan]: Boolean(aktif) });
      dunia.config = simpan.config;
      simpan.errors.forEach((pesan) => console.log(chalk.yellow(`  ⚠ ${pesan}`)));
      console.log(
        chalk.green(`  ✔ ${LABEL[pilihan]} ${dunia.config[pilihan] ? 'diaktifkan' : 'dinonaktifkan'}.`),
      );
      continue;
    }

    const batas = BATAS[pilihan];
    const { nilai } = await tanya({
      type: 'text',
      name: 'nilai',
      message: `${LABEL[pilihan]} (${batas.min}-${batas.max}):`,
      initial: String(dunia.config[pilihan]),
      validate: (v) => {
        const angka = Number(String(v ?? '').trim());
        if (!Number.isFinite(angka)) return 'Harus berupa angka';
        if (angka < batas.min || angka > batas.max) return `Harus antara ${batas.min} dan ${batas.max}`;
        return true;
      },
    });

    const simpan = saveConfig({ ...dunia.config, [pilihan]: Number(String(nilai).trim()) });
    dunia.config = simpan.config;
    simpan.errors.forEach((pesan) => console.log(chalk.yellow(`  ⚠ ${pesan}`)));
    console.log(chalk.green(`  ✔ ${LABEL[pilihan]} disimpan: ${dunia.config[pilihan]}`));
  }
}

/** Alur "Lihat Riwayat". */
async function alurRiwayat(dunia) {
  for (;;) {
    const stat = statistikLog();
    console.log('');
    console.log(garis());
    console.log(chalk.bold('  RIWAYAT PENGIRIMAN'));
    console.log(garis());
    console.log(`  Folder  : ${LOGS_DIR}`);
    console.log(`  Total   : ${stat.total} file (${stat.bulk} bulk, ${stat.dryrun} dry run, ${stat.diagnosa} diagnosa) • ${stat.ukuranTeks}`);
    console.log('');

    const daftar = daftarLog({ limit: 15 });
    if (daftar.length === 0) {
      console.log(chalk.gray('  Belum ada riwayat.'));
      console.log('');
      await tungguEnter();
      return;
    }

    const peta = new Map();
    daftar.forEach((meta) => peta.set(meta.nama, meta));

    const { nama } = await tanya({
      type: 'select',
      name: 'nama',
      message: 'Pilih sesi untuk dilihat:',
      choices: [
        ...daftar.map((meta) => {
          const isi = bacaLog(meta.path);
          const ringkas = ringkasLog(isi, meta);
          return { title: `${ringkas.judul} — ${ringkas.keterangan}`, value: meta.nama };
        }),
        { title: 'Bersihkan log lama sekarang', value: '__bersihkan' },
        { title: '← Kembali', value: '__kembali' },
      ],
    });

    if (!nama || nama === '__kembali') return;

    if (nama === '__bersihkan') {
      const hasil = bersihkanLogLama(dunia.config.logRetensi);
      console.log(
        hasil.jumlah > 0
          ? chalk.green(`  ✔ ${hasil.jumlah} log lebih tua dari ${dunia.config.logRetensi} hari dihapus.`)
          : chalk.gray('  Tidak ada log yang perlu dihapus.'),
      );
      continue;
    }

    const meta = peta.get(nama);
    if (!meta) continue;

    console.log('');
    console.log(garis('·'));
    cetakBaris(detailLog(bacaLog(meta.path)));
    console.log(garis('·'));
    console.log('');
    await tungguEnter();
  }
}

/** Alur "Bantuan & Disclaimer". */
async function alurBantuan() {
  console.log('');
  console.log(garis());
  console.log(chalk.bold('  BANTUAN & DISCLAIMER'));
  console.log(garis());
  cetakBaris([
    'Cara cepat memulai:',
    '  1. Tautkan Akun WhatsApp (QR atau pairing code).',
    '  2. Siapkan daftar nomor di file .txt (satu nomor per baris).',
    '  3. Pilih "Mulai Bulk Pesan".',
    '',
    'Format file nomor:',
    '  6281234567890',
    '  6281234567891,Budi      ← nomor,nama (untuk {{nama}})',
    '  # baris diawali # diabaikan',
    '',
    'Template pesan:',
    '  {{nama}}          → nama penerima dari file',
    '  {Halo|Hai|Halo!}  → spintax, dipilih acak per penerima',
    '',
    'Media yang didukung:',
    ...daftarEkstensi().map((baris) => `  ${baris}`),
    '',
    'Perintah terminal:',
    `  wabulk            → menjalankan CLI ini`,
    `  npm start         → alternatif tanpa npm link`,
    `  WABULK_DEBUG=1 wabulk → tampilkan log debug Baileys (untuk diagnosa)`,
    '',
    'Penerima melihat "Menunggu pesan ini"?',
    '  1. Pastikan dependency terbaru  : npm install',
    '  2. Putuskan perangkat tertaut lain di HP (WhatsApp → Perangkat Tertaut).',
    '  3. Menu Tautkan Akun → Logout & hapus sesi, lalu tautkan ulang lewat QR.',
    '  4. Pastikan "Pramuat sesi enkripsi" aktif di Pengaturan.',
    '  5. Coba kirim ulang; pesan lama yang sudah tertahan tidak bisa diperbaiki.',
    '',
    `Folder penting:`,
    `  ${ROOT_DIR}/auth_info  → session WhatsApp (JANGAN dibagikan)`,
    `  ${ROOT_DIR}/logs       → riwayat pengiriman`,
    `  ${ROOT_DIR}/config     → settings.json`,
    '',
    chalk.yellow('DISCLAIMER:'),
    '  wabulk memakai Baileys (library tidak resmi) sehingga melanggar Ketentuan',
    '  Layanan WhatsApp. Risiko pemblokiran nomor sepenuhnya tanggung jawab pengguna.',
    '  Untuk kebutuhan produksi, gunakan WhatsApp Business Cloud API resmi.',
  ]);
  console.log('');
  await tungguEnter();
}

// ---------------------------------------------------------------------------
// Menu utama
// ---------------------------------------------------------------------------

/** Loop menu utama. */
async function menuUtama(dunia) {
  for (;;) {
    const info = infoSessionTersimpan();
    const statusKoneksi = dunia.klien.tersambung ? chalk.green('tersambung') : chalk.yellow('belum tersambung');

    console.log(garis());
    console.log(
      `  Status: ${statusKoneksi} • Sesi: ${info.ada ? chalk.green('ada') : chalk.gray('belum ada')} • ` +
        `Dry run: ${dunia.config.dryRun ? chalk.green('aktif') : 'nonaktif'}`,
    );
    console.log(garis());
    console.log('');

    const { menu } = await tanya({
      type: 'select',
      name: 'menu',
      message: 'Menu Utama',
      choices: [
        { title: `Tautkan Akun WhatsApp${dunia.klien.tersambung ? chalk.green(' (tersambung)') : ''}`, value: 'tautkan' },
        { title: 'Mulai Bulk Pesan', value: 'bulk' },
        { title: 'Mode Dry Run (validasi nomor)', value: 'dryrun' },
        { title: 'Cek Kesehatan Pengiriman (diagnosa)', value: 'diagnosa' },
        { title: 'Pengaturan', value: 'pengaturan' },
        { title: 'Lihat Riwayat', value: 'riwayat' },
        { title: 'Bantuan & Disclaimer', value: 'bantuan' },
        { title: 'Keluar', value: 'keluar' },
      ],
    });

    try {
      if (!menu || menu === 'keluar') return;
      if (menu === 'tautkan') await alurTautkan(dunia);
      else if (menu === 'bulk') await alurBulk(dunia);
      else if (menu === 'dryrun') await alurDryRun(dunia);
      else if (menu === 'diagnosa') await alurDiagnosa(dunia);
      else if (menu === 'pengaturan') await alurPengaturan(dunia);
      else if (menu === 'riwayat') await alurRiwayat(dunia);
      else if (menu === 'bantuan') await alurBantuan();
    } catch (error) {
      if (isDibatalkan(error)) throw error;
      // Satu menu error tidak boleh menjatuhkan seluruh aplikasi.
      console.log(chalk.red(`\n  ✖ Terjadi kesalahan: ${error.message}\n`));
    }
  }
}

/**
 * Titik masuk aplikasi (dipanggil dari bin/wabulk.js).
 * @returns {Promise<number>} exit code
 */
export async function mulaiAplikasi() {
  tampilkanBanner();

  // Wadah state global aplikasi (diisi setelah klien dibuat).
  const duniaRef = {
    config: null,
    klien: null,
    sinyal: buatSinyal(),
    tampilkanQr: false,
  };

  // Muat konfigurasi + bersihkan log lama.
  const muat = loadConfig();
  const config = muat.config;
  muat.errors.forEach((pesan) => console.log(chalk.yellow(`  ⚠ ${pesan}`)));

  const bersih = bersihkanLogLama(config.logRetensi);
  if (bersih.jumlah > 0) {
    console.log(chalk.gray(`  ℹ ${bersih.jumlah} log lebih tua dari ${config.logRetensi} hari dihapus otomatis.`));
  }

  const klien = new KlienWhatsApp({
    onStatus: buatPrinterStatus(),
    onQr: (qr) => {
      if (duniaRef.tampilkanQr) tampilkanQr(qr);
    },
    onPairingCode: ({ kodeTampil }) => {
      console.log('');
      console.log(chalk.bold.cyan('  KODE PAIRING ANDA:'));
      console.log(chalk.bold.white(`      ${kodeTampil}`));
      console.log('');
      console.log(chalk.gray('  Buka WhatsApp → Setelan → Perangkat Tertaut → Tautkan dengan nomor telepon.'));
      console.log(chalk.gray('  Masukkan kode di atas pada kolom yang tersedia.'));
      console.log('');
    },
  });

  duniaRef.config = config;
  duniaRef.klien = klien;

  console.log(chalk.gray(`  ${salamWaktu()}! Folder project: ${ROOT_DIR}`));
  console.log('');

  // Sambung otomatis bila session tersimpan (tanpa perlu scan ulang).
  if (adaSessionTersimpan() && !klien.tersambung) {
    klien
      .sambungkan({ metode: 'qr', timeoutMs: 60000 })
      .then(() => {
        console.log(chalk.green('  ✔ Sesi tersimpan aktif. Siap dipakai.'));
      })
      .catch((error) => {
        console.log(chalk.yellow(`  ⚠ Tidak bisa menyambung dengan sesi tersimpan: ${error.message}`));
        console.log(chalk.gray('    Pilih "Tautkan Akun WhatsApp" untuk menautkan ulang.'));
      });
  }

  try {
    await menuUtama(duniaRef);
    console.log('');
    console.log(chalk.cyan('  Terima kasih sudah memakai wabulk. Sampai jumpa! 👋'));
    console.log(chalk.gray('  Ingat: gunakan hanya untuk testing dengan nomor sekali pakai.'));
    console.log('');
    return 0;
  } finally {
    await klien.tutup().catch(() => {});
    await delay(100);
  }
}

// Ekspor tambahan agar mudah diuji terpisah.
export { alurBulk, alurDiagnosa, alurDryRun, alurPengaturan, alurRiwayat, alurTautkan, pilihSumberNomor, perluasPath };
