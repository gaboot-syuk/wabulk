/**
 * proxy.js — parser & pengelola proxy untuk wabulk.
 *
 * Format yang didukung:
 *   host:port
 *   user:pass@host:port
 *   http://host:port
 *   socks5://user:pass@host:port
 */
import { delay, potong } from './utils.js';

/** Skema proxy yang didukung. */
export const SKEMA_DIDUKUNG = Object.freeze(['http', 'https', 'socks', 'socks4', 'socks5', 'socks5h']);

/** True bila skema memakai SOCKS. */
export function adalahSocks(protokol) {
  return String(protokol ?? '').toLowerCase().startsWith('socks');
}

/**
 * Parse satu string proxy.
 * @param {string} input
 * @returns {{ok: boolean, url: string, protokol?: string, host?: string, port?: number, username?: string, password?: string, error?: string}}
 */
export function parseProxy(input) {
  const gagal = (error) => ({ ok: false, url: '', error });

  if (input === null || input === undefined) return gagal('Proxy kosong');
  let teks = String(input).trim();
  if (!teks) return gagal('Proxy kosong');

  // Tambahkan skema default bila pengguna tidak menulisnya.
  if (!teks.includes('://')) teks = `http://${teks}`;

  const skema = teks.slice(0, teks.indexOf('://')).toLowerCase();
  if (!SKEMA_DIDUKUNG.includes(skema)) {
    return gagal(`Protokol "${skema}" belum didukung (pakai http, https, socks4, atau socks5)`);
  }

  let url;
  try {
    url = new URL(teks);
  } catch {
    return gagal('Format proxy tidak valid');
  }

  const protokol = url.protocol.replace(':', '').toLowerCase();
  const host = url.hostname;
  const port = url.port ? Number(url.port) : null;

  if (!host) return gagal('Host proxy kosong');
  if (!port) return gagal('Port proxy wajib diisi (contoh: 127.0.0.1:8080)');
  if (!Number.isInteger(port) || port < 1 || port > 65535) return gagal(`Port proxy tidak valid: ${url.port}`);

  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;

  // Bentuk ulang URL yang sudah bersih & konsisten.
  const kredensial = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password ?? '')}@`
    : '';
  const urlBersih = `${protokol}://${kredensial}${host}:${port}`;

  return { ok: true, url: urlBersih, protokol, host, port, username, password };
}

/** Samarkan password proxy untuk ditampilkan. */
export function ringkasProxy(input) {
  let url = '';
  if (typeof input === 'string') {
    const hasil = parseProxy(input);
    url = hasil.ok ? hasil.url : String(input);
  } else if (input && typeof input === 'object' && typeof input.url === 'string') {
    url = input.url;
  } else {
    return potong(String(input ?? '-'), 40);
  }
  return url.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:••••@');
}

/** Buat agent proxy (HTTP atau SOCKS5) untuk dipakai Baileys. */
export async function buatAgent(input) {
  const hasil = parseProxy(input);
  if (!hasil.ok) throw new Error(`Proxy tidak valid: ${hasil.error}`);

  if (adalahSocks(hasil.protokol)) {
    const { SocksProxyAgent } = await import('socks-proxy-agent');
    return new SocksProxyAgent(hasil.url);
  }
  const { HttpsProxyAgent } = await import('https-proxy-agent');
  return new HttpsProxyAgent(hasil.url);
}

/** Buang proxy duplikat / tidak valid dari daftar. */
export function normalisasiDaftarProxy(daftar = []) {
  const valid = [];
  const tidakValid = [];
  for (const item of daftar) {
    const hasil = parseProxy(item);
    if (hasil.ok) {
      if (!valid.includes(hasil.url)) valid.push(hasil.url);
    } else {
      tidakValid.push({ input: String(item), error: hasil.error });
    }
  }
  return { valid, tidakValid };
}

/** Penggilir proxy per batch (round-robin). */
export class RotatorProxy {
  /**
   * @param {string[]} daftar daftar URL proxy valid
   * @param {{rotatePerBatch?: boolean}} opsi
   */
  constructor(daftar = [], opsi = {}) {
    const { valid } = normalisasiDaftarProxy(daftar);
    this.daftar = valid;
    this.rotatePerBatch = opsi.rotatePerBatch !== false;
    this.urutan = 0;
  }

  get ukuran() {
    return this.daftar.length;
  }

  get kosong() {
    return this.daftar.length === 0;
  }

  /** Proxy untuk batch ke-`indexBatch` (0-based). */
  ambilUntukBatch(indexBatch = 0) {
    if (this.kosong) return null;
    if (!this.rotatePerBatch) return this.daftar[0];
    const index = Math.abs(Number(indexBatch) || 0) % this.daftar.length;
    return this.daftar[index];
  }

  /** Proxy berikutnya secara bergiliran. */
  berikutnya() {
    if (this.kosong) return null;
    const nilai = this.daftar[this.urutan % this.daftar.length];
    this.urutan += 1;
    return nilai;
  }
}

/** Buat rotator dari blok konfigurasi proxy (boleh null). */
export function buatRotator(proxyCfg) {
  if (!proxyCfg || typeof proxyCfg !== 'object') return null;
  if (proxyCfg.enabled === false) return null;
  const daftar = Array.isArray(proxyCfg.list) ? proxyCfg.list : [];
  if (daftar.length === 0) return null;
  return new RotatorProxy(daftar, { rotatePerBatch: proxyCfg.rotatePerBatch !== false });
}

/** Ringkasan konfigurasi proxy untuk ditampilkan di menu. */
export function ringkasKonfigurasiProxy(proxyCfg) {
  if (!proxyCfg || typeof proxyCfg !== 'object' || !Array.isArray(proxyCfg.list) || proxyCfg.list.length === 0) {
    return 'tidak dipakai';
  }
  const status = proxyCfg.enabled === false ? 'nonaktif' : 'aktif';
  const rotasi = proxyCfg.rotatePerBatch !== false ? 'rotasi tiap batch' : 'statis (proxy pertama)';
  return `${proxyCfg.list.length} proxy • ${status} • ${rotasi}`;
}

/** Daftar proxy (url tersamarkan) untuk ditampilkan. */
export function daftarProxyTampil(proxyCfg) {
  if (!proxyCfg || !Array.isArray(proxyCfg.list)) return [];
  return proxyCfg.list.map((url, index) => `${index + 1}. ${ringkasProxy(url)}`);
}

/**
 * Siapkan agent untuk batch ke-`indexBatch`.
 * @returns {Promise<{proxy: string|null, agent: object|null}>}
 */
export async function siapkanAgentBatch(proxyCfg, indexBatch = 0) {
  const rotator = buatRotator(proxyCfg);
  if (!rotator) return { proxy: null, agent: null };

  const proxy = rotator.ambilUntukBatch(indexBatch);
  if (!proxy) return { proxy: null, agent: null };

  try {
    const agent = await buatAgent(proxy);
    return { proxy, agent };
  } catch (error) {
    throw new Error(`Gagal menyiapkan proxy untuk batch ${indexBatch + 1}: ${error.message}`);
  }
}

/** Jeda singkat setelah pergantian proxy agar koneksi stabil. */
export async function jedaSetelahGantiProxy() {
  await delay(1200);
}
