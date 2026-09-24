/**
 * auth.js — autentikasi WhatsApp (QR Code & Pairing Code), session persisten,
 * dan auto-reconnect.
 *
 * Semua detail Baileys disembunyikan di dalam kelas `KlienWhatsApp` supaya
 * modul lain cukup memanggil `sambungkan()`, `kirim()`, dan `tutup()`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { AUTH_DIR, STATUS_ACK_TUNTAS, bacaJson, delay, fileAda, normalisasiNomor, pastikanFolder, sanitizeNomor } from './utils.js';
import { buatAgent, ringkasProxy } from './proxy.js';

/**
 * Logger Baileys.
 * Secara default senyap (silent) agar terminal tetap bersih.
 * Setel `WABULK_DEBUG=1` saat menjalankan wabulk untuk melihat log debug Baileys
 * (berguna ketika menelusuri masalah pengiriman).
 */
const loggerSenyap = pino({ level: process.env.WABULK_DEBUG ? 'debug' : 'silent' });

/** Batas percobaan reconnect otomatis sebelum menyerah. */
export const MAKS_RECONNECT = 5;

/** Berapa lama pesan terkirim disimpan untuk melayani permintaan ulang (retry). */
export const TTL_PESAN_RETRY_MS = 20 * 60 * 1000; // 20 menit

/** Jumlah maksimum pesan terkirim yang disimpan di memori. */
export const MAKS_PESAN_RETRY = 500;

/**
 * Penyimpanan pesan terkirim di memori (LRU + TTL).
 *
 * Dipakai untuk melayani permintaan kirim ulang (retry receipt) dari penerima.
 * Ketika penerima gagal mendekripsi pesan pada percobaan pertama — hal yang wajar
 * saat sesi enkripsi baru dibuat, terutama untuk kontak ber-`@lid` dan perangkat
 * iPhone — WhatsApp meminta pengirim mengirim ulang pesan tersebut. Tanpa
 * mekanisme ini, penerima akan selamanya melihat tulisan
 * "Menunggu pesan ini. Ini mungkin membutuhkan waktu beberapa saat."
 */
export class PenyimpanPesanTerkirim {
  constructor(opsi = {}) {
    this.maks = opsi.maks ?? MAKS_PESAN_RETRY;
    this.ttlMs = opsi.ttlMs ?? TTL_PESAN_RETRY_MS;
    this.peta = new Map();
  }

  /** Simpan isi pesan (proto.IMessage) dengan id pesan sebagai kunci. */
  simpan(id, remoteJid, isi) {
    if (!id || !isi) return;
    this.peta.delete(id); // hapus dulu agar urutan LRU benar
    this.peta.set(id, { remoteJid: remoteJid || '', isi, waktu: Date.now() });

    while (this.peta.size > this.maks) {
      const tertua = this.peta.keys().next().value;
      this.peta.delete(tertua);
    }
  }

  /** Ambil isi pesan berdasarkan id (undefined bila sudah kedaluwarsa/tidak ada). */
  ambil(id) {
    const entri = this.peta.get(id);
    if (!entri) return undefined;
    if (Date.now() - entri.waktu > this.ttlMs) {
      this.peta.delete(id);
      return undefined;
    }
    this.peta.delete(id);
    this.peta.set(id, entri); // perbarui posisi LRU
    return entri.isi;
  }

  get ukuran() {
    return this.peta.size;
  }

  kosongkan() {
    this.peta.clear();
  }
}

/** Batas waktu default menunggu koneksi terbuka (ms). */
export const TIMEOUT_SAMBUNG = 180000;

/** Penjelasan kode disconnect WhatsApp dalam Bahasa Indonesia. */
export const ALASAN_PUTUS = Object.freeze({
  401: 'Sesi logout dari perangkat lain. Tautkan ulang akun.',
  403: 'Akun ditolak/dibatasi sementara oleh WhatsApp.',
  408: 'Koneksi habis waktu (timeout). Mencoba menyambung ulang.',
  428: 'Koneksi ditutup oleh server. Mencoba menyambung ulang.',
  440: 'Sesi digantikan login di perangkat lain. Sambungkan ulang.',
  500: 'Sesi tidak sinkron. Coba tautkan ulang bila terus berulang.',
  515: 'Server meminta restart koneksi. Menyambung ulang otomatis.',
});

/**
 * Status sesi tersimpan.
 * - `ada`       : ada file auth_info/creds.json
 * - `terdaftar` : pairing/QR pernah berhasil (WAJIB untuk memakai session)
 * - `nomor`     : nomor akun yang tersimpan (bila ada)
 */
export function statusSesi() {
  const creds = bacaJson(path.join(AUTH_DIR, 'creds.json'), null);
  const id = creds?.me?.id ? String(creds.me.id) : null;
  return {
    ada: Boolean(creds),
    terdaftar: Boolean(creds?.registered),
    nomor: id ? id.split('@')[0].split(':')[0] : null,
  };
}

/** True bila ada file sesi tersimpan (belum tentu sudah terdaftar). */
export function adaSessionTersimpan() {
  return statusSesi().ada;
}

/** True bila sesi sudah terdaftar (artinya bisa dipakai menyambung). */
export function sesiTerdaftar() {
  return statusSesi().terdaftar;
}

/** Info singkat sesi tersimpan. */
export function infoSessionTersimpan() {
  const creds = path.join(AUTH_DIR, 'creds.json');
  if (!fileAda(creds)) {
    return { ada: false, pesan: 'Belum ada sesi. Silakan tautkan akun WhatsApp.' };
  }
  let stat = null;
  try {
    stat = fs.statSync(creds);
  } catch {
    stat = null;
  }
  return {
    ada: true,
    pesan: 'Sesi tersimpan ditemukan.',
    diubahPada: stat ? stat.mtime.toISOString() : null,
    folder: AUTH_DIR,
  };
}

/** Hapus semua file sesi (dipakai untuk logout / reset). */
export function hapusSessionTersimpan() {
  let dihapus = 0;
  try {
    pastikanFolder(AUTH_DIR);
    for (const nama of fs.readdirSync(AUTH_DIR)) {
      if (nama === '.gitkeep') continue;
      try {
        fs.rmSync(path.join(AUTH_DIR, nama), { recursive: true, force: true });
        dihapus += 1;
      } catch {
        /* lewati file yang sedang dipakai */
      }
    }
    return { ok: true, dihapus };
  } catch (error) {
    return { ok: false, dihapus, error: error.message };
  }
}

/** Bungkus promise dengan batas waktu. */
function denganBatasWaktu(promise, timeoutMs, pesanWaktuHabis) {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer = null;
  const batas = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(pesanWaktuHabis)), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, batas]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Klien WhatsApp wabulk.
 *
 * Callback yang bisa diberikan:
 * - `onQr(qr)`          → QR baru siap ditampilkan
 * - `onStatus(info)`    → { status, pesan, statusCode? }
 * - `onPairingCode(o)`  → { kode, kodeTampil }
 *
 * Klien juga mengeluarkan event (EventEmitter):
 * - `pesan.update`  → update status pengiriman (ack) dari Baileys
 * - `pesan.masuk`   → pesan masuk
 * - `retry.dilayani`→ permintaan kirim ulang dari penerima berhasil dilayani
 */
export class KlienWhatsApp extends EventEmitter {
  constructor(opsi = {}) {
    super();

    this.onQr = typeof opsi.onQr === 'function' ? opsi.onQr : () => {};
    this.onStatus = typeof opsi.onStatus === 'function' ? opsi.onStatus : () => {};
    this.onPairingCode = typeof opsi.onPairingCode === 'function' ? opsi.onPairingCode : () => {};

    this.sock = null;
    this.tersambung = false;
    this.sedangMenyambung = false;
    this.menutup = false;
    this.logoutDiminta = false;

    this.agent = opsi.agent || null; // agent proxy (opsional)
    this.proxyAktif = null; // URL proxy yang sedang dipakai

    this.metodeTerakhir = 'qr';
    this.nomorTerakhir = null;

    this._saveCreds = null;
    this._deferred = null;
    this._reconnectTimer = null;
    this._percobaanReconnect = 0;
    this._versiBaileys = null;
    this._pesanTerkirim = new PenyimpanPesanTerkirim();
    this._retryDilayani = 0;
    this._handshakeSelesai = false; // true setelah event 'connecting' diraih
  }

  /** Buat objek penampung promise "menunggu koneksi terbuka". */
  _janjiBaru() {
    const penampung = {};
    penampung.promise = new Promise((resolve, reject) => {
      penampung.resolve = resolve;
      penampung.reject = reject;
    });
    // Cegah unhandled rejection saat promise tidak ditunggu siapa pun.
    penampung.promise.catch(() => {});
    this._deferred = penampung;
    return penampung;
  }

  _selesaikanTerbuka(sock) {
    if (this._deferred) {
      this._deferred.resolve(sock);
      this._deferred = null;
    }
  }

  _gagalkanTerbuka(error) {
    if (this._deferred) {
      this._deferred.reject(error);
      this._deferred = null;
    }
  }

  /** Buat socket Baileys (tanpa menunggu koneksi terbuka). */
  async _buatSocket() {
    pastikanFolder(AUTH_DIR);

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    this._saveCreds = saveCreds;

    // Versi WhatsApp Web terbaru; bila gagal, biarkan Baileys memakai default.
    if (!this._versiBaileys) {
      try {
        const { version } = await fetchLatestBaileysVersion();
        this._versiBaileys = version;
      } catch {
        this._versiBaileys = null;
      }
    }

    const opsiSocket = {
      logger: loggerSenyap,
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, loggerSenyap),
      },
      // Pakai identitas browser default Baileys (Chrome di Ubuntu) — kombinasi
      // yang paling teruji untuk QR maupun pairing code.
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      defaultQueryTimeoutMs: 60000,
      retryRequestDelayMs: 1500,
      emitOwnEvents: false,
      // WAJIB agar penerima tidak tertahan di pesan "Menunggu pesan ini".
      // Ketika dekripsi gagal di penerima, WhatsApp meminta pengirim mengirim
      // ulang lewat callback ini. Harus mengembalikan KONTEN pesan (proto.IMessage),
      // bukan objek WAMessage penuh.
      getMessage: async (key) => this._pesanUntukRetry(key),
    };

    if (this._versiBaileys) opsiSocket.version = this._versiBaileys;
    if (this.agent) {
      // `agent` dipakai untuk WebSocket, `fetchAgent` untuk request HTTP Baileys.
      opsiSocket.agent = this.agent;
      opsiSocket.fetchAgent = this.agent;
    }

    this.sock = makeWASocket(opsiSocket);
    this._handshakeSelesai = false;
    this._pasangEvent(this.sock);
    return this.sock;
  }

  /** Pasang handler event Baileys. */
  _pasangEvent(sock) {
    sock.ev.on('creds.update', () => {
      if (typeof this._saveCreds === 'function') {
        Promise.resolve(this._saveCreds()).catch(() => {});
      }
    });

    // Teruskan event pesan agar modul lain (mis. diagnosa) bisa memantau
    // status pengiriman tanpa harus menyentuh socket Baileys langsung.
    sock.ev.on('messages.update', (updates) => this.emit('pesan.update', updates));
    sock.ev.on('messages.upsert', (peristiwa) => this.emit('pesan.masuk', peristiwa));

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && typeof this.onQr === 'function') {
        this.onQr(qr);
      }

      if (connection === 'connecting') {
        this._handshakeSelesai = true; // socket siap menerima permintaan IQ
        this.onStatus({ status: 'menyambungkan', pesan: 'Menghubungkan ke server WhatsApp...' });
      }

      if (connection === 'open') {
        this._handshakeSelesai = true;
        this.tersambung = true;
        this.sedangMenyambung = false;
        this._percobaanReconnect = 0;
        this.onStatus({ status: 'terbuka', pesan: 'Terhubung ke WhatsApp.' });
        this._selesaikanTerbuka(sock);
      }

      if (connection === 'close') {
        this.tersambung = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const alasan = ALASAN_PUTUS[statusCode] || 'Koneksi terputus.';
        const harusLoginUlang = statusCode === DisconnectReason.loggedOut;
        const digantikan = statusCode === DisconnectReason.connectionReplaced;

        this.onStatus({
          status: 'terputus',
          pesan: alasan,
          statusCode,
          harusLoginUlang,
        });

        if (this.menutup || this.logoutDiminta) {
          this._gagalkanTerbuka(new Error('Koneksi ditutup.'));
          return;
        }

        if (harusLoginUlang) {
          this._gagalkanTerbuka(new Error(`${alasan} Silakan tautkan ulang akun.`));
          return;
        }

        if (digantikan) {
          this._gagalkanTerbuka(new Error(`${alasan} wabulk tidak akan menyambung ulang.`));
          return;
        }

        this._jadwalkanReconnect(statusCode);
      }
    });
  }

  /** Reconnect otomatis dengan jeda bertingkat (kecuali sudah terlalu sering). */
  _jadwalkanReconnect(statusCode) {
    if (this._reconnectTimer) return;
    this._percobaanReconnect += 1;

    if (this._percobaanReconnect > MAKS_RECONNECT) {
      this._gagalkanTerbuka(
        new Error(
          `Gagal menyambung ulang setelah ${MAKS_RECONNECT} percobaan. ` +
            'Periksa koneksi internet / proxy, lalu jalankan ulang wabulk.',
        ),
      );
      return;
    }

    // 515 (restart required) & 428 bisa langsung disambung ulang.
    const instan = statusCode === 515 || statusCode === 428;
    const jeda = instan ? 1500 : Math.min(3000 * this._percobaanReconnect, 30000);

    this.onStatus({
      status: 'menyambungkan',
      pesan: `Menyambung ulang (percobaan ${this._percobaanReconnect}/${MAKS_RECONNECT}) dalam ${Math.round(jeda / 1000)} detik...`,
      statusCode,
    });

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this.menutup || this.logoutDiminta) return;
      try {
        await this._buatSocket();
      } catch (error) {
        this.onStatus({ status: 'galat', pesan: `Gagal menyambung ulang: ${error.message}` });
        this._jadwalkanReconnect(statusCode);
      }
    }, jeda);
    if (typeof this._reconnectTimer.unref === 'function') this._reconnectTimer.unref();
  }

  /**
   * Sambungkan (pertama kali atau pakai sesi tersimpan).
   * @param {{metode?: 'qr'|'pairing', nomorTelepon?: string, timeoutMs?: number, agent?: object|null}} opsi
   * @returns {Promise<object>} socket Baileys yang sudah terbuka
   */
  async sambungkan(opsi = {}) {
    const metode = opsi.metode === 'pairing' ? 'pairing' : 'qr';
    const timeoutMs = opsi.timeoutMs ?? TIMEOUT_SAMBUNG;

    if (opsi.agent !== undefined) {
      this.agent = opsi.agent;
    }

    this.metodeTerakhir = metode;
    if (opsi.nomorTelepon) this.nomorTerakhir = String(opsi.nomorTelepon).replace(/[^\d]/g, '');

    this.logoutDiminta = false;
    this.menutup = false;

    // Sudah tersambung → langsung pakai socket yang ada.
    if (this.sock && this.tersambung) return this.sock;

    // Sedang menyambung / menunggu reconnect → cukup tunggu yang berjalan,
    // jangan membuat socket kedua (bisa membuang session).
    if (this.sock && this._deferred && (this.sedangMenyambung || this._reconnectTimer)) {
      return denganBatasWaktu(
        this._deferred.promise,
        timeoutMs,
        'Waktu habis menunggu koneksi WhatsApp. Periksa koneksi internet lalu coba lagi.',
      );
    }

    this.sedangMenyambung = true;

    // Sisa sesi yang belum terdaftar (pernah pairing/scan tetapi gagal) dapat
    // membuat handshake berikutnya ditolak WhatsApp. Bersihkan agar proses
    // tautkan dimulai dari nol dengan kunci yang segar.
    const status = statusSesi();
    const sudahTerdaftar = status.terdaftar;
    if (status.ada && !status.terdaftar) {
      this.onStatus({
        status: 'info',
        pesan: 'Menghapus sisa sesi yang belum terdaftar agar proses tautkan bersih...',
      });
      hapusSessionTersimpan();
    }

    const penampung = this._janjiBaru();

    await this._buatSocket();

    // Pairing code hanya diperlukan bila sesi belum terdaftar.
    if (metode === 'pairing' && !sudahTerdaftar) {
      await this._mintaPairingCode(this.nomorTerakhir);
    }

    return denganBatasWaktu(
      penampung.promise,
      timeoutMs,
      'Waktu habis menunggu koneksi WhatsApp. Periksa koneksi internet lalu coba lagi.',
    );
  }

  /**
   * Tunggu socket siap mengirim permintaan IQ (websocket terbuka + handshake
   * Noise selesai). Tanpa ini, `requestPairingCode` bisa gagal dengan
   * "Connection Closed" di koneksi yang lambat.
   */
  async _tungguSiapKirim(timeoutMs = 25000) {
    const mulai = Date.now();

    // 1. Tunggu websocket benar-benar terbuka.
    while (!this.sock?.ws?.isOpen) {
      if (Date.now() - mulai > timeoutMs) {
        throw new Error('Koneksi ke server WhatsApp belum terbuka. Periksa internet/VPN lalu coba lagi.');
      }
      await delay(200);
    }

    // 2. Tunggu handshake selesai (event connection: 'connecting').
    while (!this._handshakeSelesai && Date.now() - mulai < timeoutMs) {
      await delay(150);
    }

    return true;
  }

  /**
   * Minta 8 digit pairing code dari WhatsApp.
   *
   * Syarat dari WhatsApp (lihat dokumentasi Baileys): nomor HARUS berformat
   * internasional tanpa "+", spasi, tanda kurung, atau tanda hubung — mis.
   * `6281234567890` (bukan `081234567890`).
   */
  async _mintaPairingCode(nomorTelepon) {
    if (!nomorTelepon) {
      throw new Error('Nomor telepon wajib diisi untuk metode pairing code.');
    }

    // Rapikan: buang 0 di depan, ubah ke kode negara (mis. 62), buang simbol.
    const nomor = sanitizeNomor(nomorTelepon);
    const periksa = normalisasiNomor(nomor);
    if (!periksa.ok || periksa.adalahGrup) {
      throw new Error(
        `Nomor telepon tidak valid${periksa.error ? `: ${periksa.error}` : ''}. ` +
          'Gunakan format internasional, contoh: 6281234567890',
      );
    }

    if (this.sock?.authState?.creds?.registered) {
      this.onStatus({ status: 'info', pesan: 'Sesi sudah terdaftar, pairing code tidak diperlukan.' });
      return null;
    }

    await this._tungguSiapKirim();
    await delay(600); // beri jeda singkat setelah handshake

    let kode = null;
    let galatTerakhir = null;

    for (let percobaan = 1; percobaan <= 3 && !kode; percobaan += 1) {
      try {
        kode = await this.sock.requestPairingCode(nomor);
      } catch (error) {
        galatTerakhir = error;
        const pesan = String(error?.message || error);
        const bisaDiulang = /connection closed|timed? ?out|not open|websocket/i.test(pesan);

        this.onStatus({
          status: 'info',
          pesan: `Permintaan pairing code gagal (percobaan ${percobaan}/3): ${pesan}`,
        });

        if (!bisaDiulang || percobaan === 3) break;
        await delay(2500);
      }
    }

    if (!kode) {
      throw new Error(
        `Gagal meminta pairing code: ${galatTerakhir?.message || 'tidak diketahui'}. ` +
          `Pastikan nomor ${nomor} terdaftar di WhatsApp, koneksi internet stabil, ` +
          'dan aplikasi WhatsApp di HP sudah versi terbaru (mendukung "Tautkan dengan nomor telepon").',
      );
    }

    const kodeRapi = String(kode).replace(/[^A-Za-z0-9]/g, '');
    const kodeTampil = kodeRapi.length === 8 ? `${kodeRapi.slice(0, 4)}-${kodeRapi.slice(4)}` : kodeRapi;

    this.onPairingCode({ kode: kodeRapi, kodeTampil, nomor });
    return kodeRapi;
  }

  /** Tunggu sampai koneksi benar-benar terbuka (dipakai sebelum mengirim). */
  async tungguSiap(timeoutMs = 90000) {
    if (this.tersambung && this.sock) return this.sock;
    if (!this.sock) {
      throw new Error('Belum ada koneksi. Tautkan akun WhatsApp terlebih dahulu.');
    }
    const penampung = this._deferred ?? this._janjiBaru();
    return denganBatasWaktu(
      penampung.promise,
      timeoutMs,
      'Koneksi WhatsApp belum siap. Coba lagi sebentar lagi.',
    );
  }

  /**
   * Ganti proxy: tutup socket lama (session tetap tersimpan) lalu sambung ulang.
   * Dipakai untuk rotasi proxy per batch.
   */
  async gantiProxy(proxyUrl) {
    let agent = null;
    if (proxyUrl) {
      agent = await buatAgent(proxyUrl);
    }

    this.onStatus({
      status: 'info',
      pesan: proxyUrl ? `Beralih ke proxy ${ringkasProxy(proxyUrl)}` : 'Melepas proxy (koneksi langsung).',
    });

    await this.tutupSocket();
    this.agent = agent;
    this.proxyAktif = proxyUrl || null;
    this.menutup = false;
    this.logoutDiminta = false;
    this._percobaanReconnect = 0;

    const penampung = this._janjiBaru();
    await this._buatSocket();
    await denganBatasWaktu(penampung.promise, 90000, 'Gagal beralih proxy: koneksi tidak terbuka.');
    return this.sock;
  }

  /** Tutup socket tanpa menghapus session. */
  async tutupSocket() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    const soket = this.sock;
    this.sock = null;
    this.tersambung = false;
    if (soket) {
      try {
        soket.ev.removeAllListeners?.('connection.update');
        soket.ev.removeAllListeners?.('creds.update');
        soket.ev.removeAllListeners?.('messages.update');
        soket.ev.removeAllListeners?.('messages.upsert');
      } catch {
        /* abaikan */
      }
      try {
        soket.end(undefined);
      } catch {
        /* socket mungkin sudah tertutup */
      }
    }
    await delay(300);
  }

  /** Tutup koneksi karena aplikasi keluar. */
  async tutup() {
    this.menutup = true;
    await this.tutupSocket();
  }

  /** Logout dari WhatsApp (session dihapus, harus tautkan ulang). */
  async logout() {
    this.logoutDiminta = true;
    try {
      if (this.sock) await this.sock.logout();
    } catch {
      /* tetap lanjut menghapus file sesi */
    }
    await this.tutupSocket();
    this._pesanTerkirim.kosongkan();
    const hasil = hapusSessionTersimpan();
    return hasil;
  }

  /** Kirim pesan (teks / media). Dilempar ke atas bila gagal. */
  async kirim(jid, isi, opsi = {}) {
    const soket = this.sock;
    if (!soket) throw new Error('Belum tersambung ke WhatsApp.');
    const pesanTerkirim = await soket.sendMessage(jid, isi, opsi);
    // Simpan isi pesan agar bisa dikirim ulang bila penerima minta retry.
    this.catatPesanTerkirim(pesanTerkirim, isi);
    return pesanTerkirim;
  }

  /** Simpan isi pesan yang berhasil dikirim ke penyimpanan retry. */
  catatPesanTerkirim(pesanTerkirim, isi) {
    if (!pesanTerkirim || !pesanTerkirim.key || !isi) return;
    this._pesanTerkirim.simpan(pesanTerkirim.key.id, pesanTerkirim.key.remoteJid, isi);
  }

  /**
   * Callback `getMessage` Baileys — mengembalikan isi pesan yang pernah dikirim
   * supaya Baileys dapat mengenkripsi ulang saat penerima meminta retry.
   * @returns {object|undefined} proto.IMessage (mis. `{ text: '...' }`)
   */
  _pesanUntukRetry(key) {
    const id = key?.id;
    if (!id) return undefined;
    const isi = this._pesanTerkirim.ambil(id);
    if (!isi) return undefined;

    // Catat sebagai retry yang berhasil dilayani (dipakai fitur diagnosa).
    this._retryDilayani += 1;
    this.emit('retry.dilayani', { id, remoteJid: key?.remoteJid ?? null });
    return isi;
  }

  /** Jumlah pesan yang sedang disimpan untuk keperluan retry (diagnostik). */
  get jumlahPesanRetry() {
    return this._pesanTerkirim.ukuran;
  }

  /** Jumlah permintaan kirim ulang dari penerima yang berhasil dilayani. */
  get jumlahRetryDilayani() {
    return this._retryDilayani;
  }

  /** JID akun yang sedang tertaut (biasanya nomor sendiri). */
  get akunSaya() {
    const id = this.sock?.user?.id;
    if (!id) return null;
    try {
      return jidNormalizedUser(id) || null;
    } catch {
      return null;
    }
  }

  /** Nomor akun sendiri (tanpa domain JID). */
  get nomorSaya() {
    const jid = this.akunSaya;
    return jid ? jid.split('@')[0] : null;
  }

  /** Ringkasan kondisi koneksi & mekanisme retry (dipakai diagnosa). */
  infoKoneksi() {
    return {
      tersambung: this.tersambung,
      akun: this.akunSaya,
      nomor: this.nomorSaya,
      nama: this.sock?.user?.name ?? null,
      proxy: this.proxyAktif,
      pesanRetryTersimpan: this._pesanTerkirim.ukuran,
      retryDilayani: this._retryDilayani,
    };
  }

  /**
   * Tunggu status pengiriman (ack) sebuah pesan.
   * Kode status Baileys: 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED.
   * @param {string} pesanId id pesan (dari hasil sendMessage)
   * @param {{timeoutMs?: number, statusTarget?: number, onStatus?: Function}} opsi
   * @returns {Promise<{pesanId: string, dicapai: boolean, status: number|null, riwayat: Array, waktuMs: number}>}
   */
  async tungguStatus(pesanId, opsi = {}) {
    const { timeoutMs = 45000, statusTarget = STATUS_ACK_TUNTAS, onStatus = null } = opsi;

    if (!pesanId) return { pesanId: null, dicapai: false, status: null, riwayat: [], waktuMs: 0 };

    const riwayat = [];
    const mulai = Date.now();

    return new Promise((resolve) => {
      let selesai = false;
      let timer = null;

      const bereskan = (hasil) => {
        if (selesai) return;
        selesai = true;
        if (timer) clearTimeout(timer);
        this.off('pesan.update', pendengar);
        resolve(hasil);
      };

      const pendengar = (updates) => {
        for (const perubahan of updates || []) {
          if (perubahan?.key?.id !== pesanId) continue;
          const status = perubahan?.update?.status;
          if (typeof status !== 'number') continue;
          if (riwayat.some((item) => item.status === status)) continue;

          const entri = { status, waktuMs: Date.now() - mulai };
          riwayat.push(entri);
          if (typeof onStatus === 'function') onStatus(entri);

          if (status >= statusTarget) {
            bereskan({ pesanId, dicapai: true, status, riwayat, waktuMs: entri.waktuMs });
          }
        }
      };

      timer = setTimeout(() => {
        const terakhir = riwayat.length > 0 ? riwayat[riwayat.length - 1].status : null;
        bereskan({ pesanId, dicapai: false, status: terakhir, riwayat, waktuMs: Date.now() - mulai });
      }, Math.max(1000, timeoutMs));

      this.on('pesan.update', pendengar);
    });
  }

  /**
   * Pramuat sesi enkripsi (Signal) untuk satu JID sebelum pengiriman.
   * Membantu mencegah kegagalan dekripsi pada pesan pertama ke nomor baru.
   * @returns {Promise<boolean>} true bila sesi berhasil disiapkan
   */
  async siapkanSesi(jid) {
    const soket = this.sock;
    if (!soket) throw new Error('Belum tersambung ke WhatsApp.');
    if (typeof soket.assertSessions !== 'function') return false;
    await soket.assertSessions([jid], true);
    return true;
  }

  /** Cek keberadaan nomor di WhatsApp (dipakai dry run). */
  async cekNomor(...daftar) {
    const soket = await this.tungguSiap();
    return soket.onWhatsApp(...daftar);
  }
}
