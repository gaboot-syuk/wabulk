/**
 * scripts/smoke.js — pemeriksaan cepat tanpa jaringan.
 *
 * Mengimpor semua modul wabulk dan menguji fungsi murni (tanpa koneksi
 * WhatsApp). Jalankan dengan: `npm run smoke`.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  EXAMPLES_DIR,
  LOGS_DIR,
  ROOT_DIR,
  bacaFileNomor,
  bersihkanDuplikat,
  formatDurasi,
  isJidGrup,
  normalisasiNomor,
  parseBarisNomor,
  parseInputManual,
  parseJid,
  sanitizeNomor,
} from '../src/utils.js';
import { normalisasiConfig, DEFAULT_CONFIG } from '../src/config.js';
import { bacaLog, daftarLog, detailLog, ringkasLog, simpanLog } from '../src/logger.js';
import { daftarVariabel, render, renderSpintax, susunDataPenerima, validasiTemplate } from '../src/template.js';
import { periksaMedia, deteksiTipeMedia, bangunIsiMedia } from '../src/media.js';
import { parseProxy, ringkasProxy, RotatorProxy, buatRotator } from '../src/proxy.js';

let lulus = 0;
let gagal = 0;

function cek(nama, syarat, infoTambahan = '') {
  if (syarat) {
    lulus += 1;
    console.log(`  ✔ ${nama}`);
  } else {
    gagal += 1;
    console.log(`  ✖ ${nama}${infoTambahan ? ` → ${infoTambahan}` : ''}`);
  }
}

function kelompok(judul) {
  console.log(`\n${judul}`);
}

// --- utils -----------------------------------------------------------------
kelompok('utils.js');
cek('sanitizeNomor("0812-3456-7890")', sanitizeNomor('0812-3456-7890') === '6281234567890', sanitizeNomor('0812-3456-7890'));
cek('sanitizeNomor("+62 812 3456 7891")', sanitizeNomor('+62 812 3456 7891') === '6281234567891');
cek('sanitizeNomor("8123456789")', sanitizeNomor('8123456789') === '628123456789');
cek('sanitizeNomor JID grup', sanitizeNomor('120363012345678901@G.US') === '120363012345678901@g.us');
cek('parseJid', parseJid('08123') === '628123@s.whatsapp.net', parseJid('08123'));
cek('isJidGrup', isJidGrup('123@g.us') === true && isJidGrup('123@s.whatsapp.net') === false);
cek('normalisasiNomor valid', normalisasiNomor('08123456789').ok === true);
cek('normalisasiNomor terlalu pendek', normalisasiNomor('123').ok === false);
cek('parseBarisNomor nomor,nama', parseBarisNomor('6281234567890,Budi').nama === 'Budi');
cek('parseBarisNomor komentar', parseBarisNomor('# catatan').ok === false);
cek('formatDurasi(3_725_000)', formatDurasi(3725000) === '1j 2m 5d', formatDurasi(3725000));
cek('parseInputManual nomor dipisah koma', parseInputManual('628111222333, 628444555666').daftar.length === 2);
cek(
  'parseInputManual format nomor,nama',
  (() => {
    const hasil = parseInputManual('628777888999,Budi');
    return hasil.daftar.length === 1 && hasil.daftar[0].nama === 'Budi';
  })(),
);
cek('parseInputManual baris baru', parseInputManual('628111222333\n628444555666,Rina').daftar.length === 2);
cek(
  'parseInputManual membuang entri tidak valid',
  parseInputManual('abc, 628111222333').dilewati.length === 1,
);
cek('bersihkanDuplikat', bersihkanDuplikat([
  { nomor: '1', jid: '1@s.whatsapp.net' },
  { nomor: '1', jid: '1@s.whatsapp.net' },
]).duplikat.length === 1);

kelompok('utils.js — baca file contoh');
const contohPath = path.join(EXAMPLES_DIR, 'nomor.txt');
if (fs.existsSync(contohPath)) {
  const hasil = bacaFileNomor(contohPath);
  // Isi file contoh boleh diubah pengguna, jadi uji sifatnya saja (bukan nilai pasti).
  cek('examples/nomor.txt terbaca', hasil.daftar.length >= 3, `dapat ${hasil.daftar.length} nomor`);
  cek(
    'semua nomor ternormalisasi (62…)',
    hasil.daftar.every((item) => /^62\d{7,}$/.test(item.nomor)),
    JSON.stringify(hasil.daftar.map((item) => item.nomor)),
  );
  cek(
    'format "nomor,nama" terbaca',
    hasil.daftar.some((item) => item.nama && item.nama.length > 0),
    JSON.stringify(hasil.daftar.map((item) => item.nama)),
  );
} else {
  cek('examples/nomor.txt ada', false, 'file tidak ditemukan');
}

// --- template --------------------------------------------------------------
kelompok('template.js');
cek('renderVariabel', render('Halo {{nama}}!', { nama: 'Budi' }) === 'Halo Budi!');
cek('variabel tanpa spasi', render('{{ nama }}', { nama: 'Siti' }) === 'Siti');
cek('variabel tak dikenal dihapus', render('A{{xx}}B', {}) === 'AB');
cek('spintax memilih opsi valid', ['Halo', 'Hai'].includes(renderSpintax('{Halo|Hai}')));
cek('spintax bersarang', ['Halo Bapak', 'Halo Ibu', 'Hai'].includes(renderSpintax('{Halo {Bapak|Ibu}|Hai}')));
cek('teks tanpa spintax utuh', renderSpintax('tanpa kurung') === 'tanpa kurung');
cek('kurung tanpa | dibiarkan', renderSpintax('{literal}') === '{literal}');
cek('daftarVariabel', JSON.stringify(daftarVariabel('{{nama}} {{NOMOR}}')) === JSON.stringify(['nama', 'nomor']));
cek('validasiTemplate mendeteksi kurung', validasiTemplate('{Halo|Hai').peringatan.length > 0);
cek('susunDataPenerima', susunDataPenerima({ nomor: '628', nama: 'A' }, 0, 2).total === '2');

// --- media -----------------------------------------------------------------
kelompok('media.js');
cek('deteksi .png', deteksiTipeMedia('a.png') === 'gambar');
cek('deteksi .mp4', deteksiTipeMedia('a.mp4') === 'video');
cek('deteksi .pdf', deteksiTipeMedia('a.pdf') === 'dokumen');
cek('deteksi .exe = null', deteksiTipeMedia('a.exe') === null);
cek('periksaMedia file hilang', periksaMedia(path.join(ROOT_DIR, 'tidak-ada.png')).ok === false);
if (fs.existsSync(contohPath)) {
  const salah = periksaMedia(contohPath, 'gambar');
  cek('periksaMedia menolak ekstensi .txt', salah.ok === false, salah.error);
}

// --- proxy -----------------------------------------------------------------
kelompok('proxy.js');
cek('parse host:port', parseProxy('127.0.0.1:8080').url === 'http://127.0.0.1:8080');
cek('parse user:pass@host:port', parseProxy('user:pass@1.2.3.4:3128').url === 'http://user:pass@1.2.3.4:3128');
cek('parse socks5', parseProxy('socks5://u:p@1.2.3.4:1080').protokol === 'socks5');
cek('tolak tanpa port', parseProxy('1.2.3.4').ok === false);
cek('tolak skema asing', parseProxy('ftp://1.2.3.4:21').ok === false);
cek('ringkasProxy menyamarkan password', !ringkasProxy('user:rahasia@1.2.3.4:3128').includes('rahasia'));
const rotator = new RotatorProxy(['http://a:1', 'http://b:1'], { rotatePerBatch: true });
cek('RotatorProxy rotasi', rotator.ambilUntukBatch(0) === 'http://a:1' && rotator.ambilUntukBatch(1) === 'http://b:1');
cek('buatRotator null tanpa proxy', buatRotator(null) === null);

// --- config ----------------------------------------------------------------
kelompok('config.js');
cek('default perBatch', normalisasiConfig({}).config.perBatch === DEFAULT_CONFIG.perBatch);
cek('koreksi nilai di luar batas', normalisasiConfig({ perBatch: 999999 }).config.perBatch === 1000);
cek('tolak tipe salah', normalisasiConfig({ perBatch: 'abc' }).errors.length > 0);
cek('tukar jedaMin > jedaMax', normalisasiConfig({ jedaMin: 20, jedaMax: 5 }).config.jedaMin === 5);
cek('dryRun non-boolean', normalisasiConfig({ dryRun: 'ya' }).config.dryRun === false);
cek('proxy valid', normalisasiConfig({ proxy: { list: ['http://1.2.3.4:8080'] } }).config.proxy !== null);
cek('proxy tidak valid dinonaktifkan', normalisasiConfig({ proxy: { list: ['ngawur'] } }).config.proxy === null);
cek('prewarmSesi default aktif', normalisasiConfig({}).config.prewarmSesi === true);
cek('prewarmSesi non-boolean → default', normalisasiConfig({ prewarmSesi: 'ya' }).config.prewarmSesi === true);
cek('prewarmSesi false dihormati', normalisasiConfig({ prewarmSesi: false }).config.prewarmSesi === false);

// --- logger ----------------------------------------------------------------
kelompok('logger.js');
const catat = simpanLog('bulk', {
  timestamp: new Date().toISOString(),
  total: 2,
  terkirim: 1,
  gagal: 1,
  perBatch: 15,
  jeda: 15,
  durasi: '0d',
  detail: [
    { nomor: '6281', status: 'sent' },
    { nomor: '6282', status: 'failed', error: 'uji' },
  ],
});
cek('simpanLog berhasil', catat.ok === true, catat.error);
if (catat.ok) {
  const isi = bacaLog(catat.path);
  cek('bacaLog mengembalikan objek', isi && isi.total === 2);
  cek('ringkasLog', ringkasLog(isi, { nama: catat.nama }).judul.includes('Bulk'));
  cek('detailLog berisi baris', detailLog(isi).length > 3);
  cek('daftarLog menemukan file', daftarLog({ limit: 5 }).some((item) => item.nama === catat.nama));
  fs.unlinkSync(catat.path); // bersihkan artefak uji
  cek('folder logs masih ada', fs.existsSync(LOGS_DIR));
}

// --- media bangunIsiMedia --------------------------------------------------
kelompok('media.js — bangunIsiMedia (uji buffer)');
const gambarUji = path.join(ROOT_DIR, 'smoke-uji.png');
fs.writeFileSync(gambarUji, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
try {
  const hasil = await bangunIsiMedia({ filePath: gambarUji, caption: 'Halo {{nama}}' });
  cek('bangunIsiMedia gambar', hasil.ok === true && Buffer.isBuffer(hasil.isi.image), hasil.error);
} catch (error) {
  cek('bangunIsiMedia gambar', false, error.message);
} finally {
  fs.unlinkSync(gambarUji);
}

// --- dry run ---------------------------------------------------------------
kelompok('dryrun.js — validasi tanpa koneksi (socket palsu)');
const { validasiDaftar, simpanHasilDryRun } = await import('../src/dryrun.js');
const sockPalsu = {
  async onWhatsApp(jid) {
    if (jid.startsWith('62899')) return []; // dianggap tidak terdaftar
    if (jid.startsWith('boom')) throw new Error('uji error');
    // Sebagian versi WhatsApp mengembalikan JID @lid di sini.
    return [{ jid: '123456789@lid', exists: true, lid: '123456789@lid' }];
  },
};
const daftarUji = [
  { nomor: '628111111111', nama: 'A', jid: '628111111111@s.whatsapp.net' },
  { nomor: '628999999999', nama: 'B', jid: '628999999999@s.whatsapp.net' },
  { nomor: '120363012345678901', nama: 'Grup', jid: '120363012345678901@g.us', adalahGrup: true },
];
const hasilValidasi = await validasiDaftar(sockPalsu, daftarUji, { jedaMs: 0 });
cek('validasi menemukan 1 nomor valid', hasilValidasi.valid.length === 1, JSON.stringify(hasilValidasi.valid));
cek(
  'JID kirim tetap nomor telepon (bukan @lid)',
  hasilValidasi.valid[0].jid === '628111111111@s.whatsapp.net' && hasilValidasi.valid[0].lid === '123456789@lid',
  JSON.stringify(hasilValidasi.valid[0]),
);
cek('validasi menemukan 1 nomor tidak valid', hasilValidasi.tidakValid.length === 1);
cek('grup dilewati dari validasi', hasilValidasi.grup.length === 1);
cek('siapKirim = valid + grup', hasilValidasi.siapKirim.length === 2);
const logDry = simpanHasilDryRun(hasilValidasi, { sumber: 'uji' });
cek('hasil dry run tersimpan', logDry.ok === true);
if (logDry.ok) fs.unlinkSync(logDry.path);

// --- sender ----------------------------------------------------------------
kelompok('sender.js — loop bulk (socket palsu)');
const { jalankanBulk } = await import('../src/sender.js');
let jumlahKirim = 0;
const sesiDipramuat = [];
const klienPalsu = {
  tersambung: true,
  sock: {},
  async kirim(jid) {
    jumlahKirim += 1;
    if (jid.startsWith('62822')) throw new Error('simulasi gagal');
  },
  async tungguSiap() {
    return {};
  },
  async siapkanSesi(jid) {
    sesiDipramuat.push(jid);
  },
};
const hasilBulk = await jalankanBulk({
  klien: klienPalsu,
  daftar: [
    { nomor: '628111111111', nama: 'A', jid: '628111111111@s.whatsapp.net' },
    { nomor: '628222222222', nama: 'B', jid: '628222222222@s.whatsapp.net' },
    { nomor: '628333333333', nama: 'C', jid: '628333333333@s.whatsapp.net' },
  ],
  teks: 'Halo {{nama}} {pagi|siang}',
  config: { perBatch: 2, jeda: 0, jedaMin: 0, jedaMax: 0, dryRun: false, proxy: null },
  sumber: 'uji',
  cetakProgres: false,
});
cek('bulk mengirim 2 pesan sukses', hasilBulk.terkirim === 2, JSON.stringify({ terkirim: hasilBulk.terkirim, gagal: hasilBulk.gagal }));
cek('bulk mencatat 1 kegagalan', hasilBulk.gagal === 1);
cek('klien dipanggil untuk setiap nomor', jumlahKirim === 4, `dipanggil ${jumlahKirim}x (1 retry)`);
cek('detail berisi 3 entri', hasilBulk.detail.length === 3);
cek('log bulk tersimpan', Boolean(hasilBulk.log));
if (hasilBulk.log) fs.unlinkSync(hasilBulk.log.path);
cek('durasi terformat', typeof hasilBulk.durasi === 'string' && hasilBulk.durasi.endsWith('d'));
cek('pramuat sesi sekali per nomor', sesiDipramuat.length === 3, JSON.stringify(sesiDipramuat));
cek('log mencatat status prewarmSesi', hasilBulk.prewarmSesi === true);

// --- auth: penyimpanan pesan & pramuat sesi --------------------------------
kelompok('auth.js — penyimpanan pesan terkirim & pramuat sesi');
const { PenyimpanPesanTerkirim, KlienWhatsApp, statusSesi, sesiTerdaftar } = await import('../src/auth.js');
const tunggu = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const simpanUji = new PenyimpanPesanTerkirim({ maks: 3, ttlMs: 60000 });
simpanUji.simpan('a', 'x@s.whatsapp.net', { text: 'satu' });
cek('simpan & ambil pesan', simpanUji.ambil('a')?.text === 'satu');
cek('ambil id tak dikenal → undefined', simpanUji.ambil('zzz') === undefined);
simpanUji.simpan('b', 'x@s.whatsapp.net', { text: 'dua' });
simpanUji.simpan('c', 'x@s.whatsapp.net', { text: 'tiga' });
simpanUji.simpan('d', 'x@s.whatsapp.net', { text: 'empat' });
cek('LRU membatasi jumlah entri', simpanUji.ukuran === 3 && simpanUji.ambil('a') === undefined);

const simpanTtl = new PenyimpanPesanTerkirim({ ttlMs: 30 });
simpanTtl.simpan('t1', 'x@s.whatsapp.net', { text: 'kedaluwarsa' });
await tunggu(60);
cek('TTL menghapus pesan lama', simpanTtl.ambil('t1') === undefined);

const klienUji = new KlienWhatsApp({});
klienUji.sock = {
  async sendMessage() {
    return { key: { id: 'MSG1', remoteJid: '628111111111@s.whatsapp.net' } };
  },
  async assertSessions() {
    return true;
  },
};
await klienUji.kirim('628111111111@s.whatsapp.net', { text: 'halo {{nama}}' });
cek('kirim menyimpan pesan untuk retry', klienUji._pesanUntukRetry({ id: 'MSG1' })?.text === 'halo {{nama}}');
cek('getMessage tanpa id → undefined', klienUji._pesanUntukRetry({}) === undefined);
cek('getMessage id asing → undefined', klienUji._pesanUntukRetry({ id: 'TIDAK-ADA' }) === undefined);
cek('jumlahPesanRetry = 1', klienUji.jumlahPesanRetry === 1);
cek('siapkanSesi memakai assertSessions', (await klienUji.siapkanSesi('628111111111@s.whatsapp.net')) === true);

// --- diagnosa ---------------------------------------------------------------
kelompok('diagnosa.js — pemantauan status pengiriman (tanpa jaringan)');
const { jalankanDiagnosa, formatLaporanDiagnosa } = await import('../src/diagnosa.js');
const klienDiag = new KlienWhatsApp({});
const idDiag = 'DIAG1';
let jidDiag = null;
klienDiag.tersambung = true;
klienDiag.sock = {
  user: { id: '628111111111:5@s.whatsapp.net', name: 'Uji Wabulk' },
  async sendMessage(jid) {
    jidDiag = jid;
    return { key: { id: idDiag, remoteJid: jid } };
  },
  async assertSessions() {
    return true;
  },
};

const janjiDiag = jalankanDiagnosa({
  klien: klienDiag,
  tujuan: '08123456789',
  timeoutMs: 4000,
  cetakProgres: false,
  simpan: false,
});
await tunggu(80);
cek('nomor akun terbaca dari session', klienDiag.nomorSaya === '628111111111', String(klienDiag.nomorSaya));
cek('tujuan uji memakai JID nomor telepon', jidDiag === '628123456789@s.whatsapp.net', String(jidDiag));

klienDiag.emit('pesan.update', [{ key: { id: idDiag }, update: { status: 2 } }]);
klienDiag.emit('pesan.update', [{ key: { id: idDiag }, update: { status: 3 } }]);
const hasilDiag = await janjiDiag;

cek('diagnosa mencapai DELIVERY_ACK', hasilDiag.tercapai === true && hasilDiag.statusAkhir === 3, JSON.stringify({ status: hasilDiag.statusAkhir }));
cek('riwayat status tercatat berurutan', hasilDiag.riwayatStatus.length === 2 && hasilDiag.riwayatStatus[0].status === 2);
cek('retry dilayani terpantau di laporan', hasilDiag.retryDilayani === 0 && hasilDiag.pesanRetryTersimpan === 1);
cek('catatan diagnosa berisi rekomendasi', Array.isArray(hasilDiag.catatan) && hasilDiag.catatan.length >= 3);
cek('formatLaporanDiagnosa terbentuk', formatLaporanDiagnosa(hasilDiag).length > 5);
cek('simpan:false tidak menulis log', hasilDiag.log === undefined);

const hasilTimeout = await klienDiag.tungguStatus('TIDAK-ADA', { timeoutMs: 1000 });
cek('tungguStatus timeout → dicapai false', hasilTimeout.dicapai === false && hasilTimeout.status === null);

const klienRetry = new KlienWhatsApp({});
klienRetry.sock = {
  async sendMessage() {
    return { key: { id: 'R1', remoteJid: '628111111111@s.whatsapp.net' } };
  },
};
await klienRetry.kirim('628111111111@s.whatsapp.net', { text: 'uji retry' });
klienRetry._pesanUntukRetry({ id: 'R1' });
klienRetry._pesanUntukRetry({ id: 'R1' });
cek('jumlahRetryDilayani menghitung retry yang dilayani', klienRetry.jumlahRetryDilayani === 2);

const logDiag = simpanLog('diagnosa', { ...hasilDiag, tipe: 'diagnosa' });
cek('log diagnosa bisa disimpan', logDiag.ok === true);
if (logDiag.ok) {
  const isiDiag = bacaLog(logDiag.path);
  cek('ringkasLog mengenali tipe diagnosa', ringkasLog(isiDiag, { nama: logDiag.nama }).judul.includes('Diagnosa'));
  cek('detailLog diagnosa berisi status', detailLog(isiDiag).some((baris) => baris.includes('Status akhir')));
  fs.unlinkSync(logDiag.path);
}

// --- pairing code -----------------------------------------------------------
kelompok('auth.js — pairing code (tanpa jaringan)');
const statusUji = statusSesi();
cek(
  'statusSesi mengembalikan bentuk yang benar',
  typeof statusUji.ada === 'boolean' && typeof statusUji.terdaftar === 'boolean',
  JSON.stringify(statusUji),
);
cek('sesiTerdaftar mengembalikan boolean', typeof sesiTerdaftar() === 'boolean');

const klienPair = new KlienWhatsApp({});
let nomorDiterima = null;
let infoKode = null;
klienPair.onPairingCode = (info) => {
  infoKode = info;
};
klienPair.sock = {
  ws: { isOpen: true },
  authState: { creds: { registered: false } },
  async requestPairingCode(nomor) {
    nomorDiterima = nomor;
    return 'ABCD1234';
  },
};
klienPair._handshakeSelesai = true;

await klienPair._mintaPairingCode('0812-3456-7890');
cek('nomor pairing dirapikan ke format internasional', nomorDiterima === '6281234567890', String(nomorDiterima));
cek('kode pairing diformat 4-4 digit', infoKode?.kodeTampil === 'ABCD-1234', String(infoKode?.kodeTampil));
cek('nomor tujuan ikut dilaporkan ke UI', infoKode?.nomor === '6281234567890');

let galatNomor = null;
try {
  await klienPair._mintaPairingCode('123');
} catch (error) {
  galatNomor = error;
}
cek(
  'nomor tidak valid ditolak dengan pesan ramah',
  Boolean(galatNomor) && /tidak valid/i.test(galatNomor.message),
  galatNomor?.message,
);

klienPair.sock.ws.isOpen = false;
klienPair._handshakeSelesai = false;
let galatSiap = null;
try {
  await klienPair._tungguSiapKirim(300);
} catch (error) {
  galatSiap = error;
}
cek('menunggu socket siap melempar pesan jelas', Boolean(galatSiap) && /belum terbuka/i.test(galatSiap.message), galatSiap?.message);
klienPair.sock.ws.isOpen = true;
klienPair._handshakeSelesai = true;

// Sesi sudah terdaftar → pairing code tidak diminta lagi.
klienPair.sock.authState.creds.registered = true;
nomorDiterima = null;
const hasilSkip = await klienPair._mintaPairingCode('08123456789');
cek('sesi terdaftar → pairing code dilewati', hasilSkip === null && nomorDiterima === null);

// --- rangkuman -------------------------------------------------------------
console.log('');
console.log(`Hasil: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
