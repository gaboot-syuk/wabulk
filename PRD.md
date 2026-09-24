# Product Requirements Document (PRD)
## wabulk — CLI Bulk WhatsApp

**Versi**: 1.0
**Status**: Selesai (implementasi v1.0)
**Tanggal**: 2026-09-24
**Penulis**: Tim wabulk

---

## 1. Latar Belakang

Pengiriman pesan WhatsApp ke banyak nomor saat ini memerlukan pemahaman teknis terhadap library seperti Baileys. Proses setup, autentikasi, dan pengelolaan jeda harus dilakukan manual di kode. Hal ini menyulitkan pengguna non-teknis yang hanya ingin mengirim pesan massal untuk testing atau keperluan internal.

**wabulk** hadir sebagai CLI interaktif yang membungkus kompleksitas Baileys menjadi alur menu sederhana: clone, install, jalankan. Alat ini ditujukan untuk **testing dan pembelajaran**, dengan peringatan risiko yang jelas di README, banner aplikasi, dan log.

---

## 2. Tujuan

### 2.1 Tujuan Utama

- Menyediakan tools bulk WhatsApp yang bisa dijalankan dengan **tiga langkah**: `git clone`, `bash install.sh`, `wabulk`.
- Menyembunyikan seluruh kompleksitas Baileys di balik **CLI interaktif** berbahasa Indonesia.
- Menyediakan fitur jeda otomatis (antar batch dan acak antar nomor) untuk **mengurangi risiko pemblokiran**.

### 2.2 Tujuan Sekunder

- Mendukung personalisasi pesan via template (`{{nama}}`) dan spintax (`{Halo|Hai}`).
- Mendukung pengiriman media (gambar, video, dokumen) dengan caption dinamis.
- Menyediakan mode dry run untuk validasi nomor sebelum kirim.
- Menyimpan riwayat pengiriman sebagai JSON untuk audit dan pembersihan daftar nomor.
- Mendukung proxy HTTP/SOCKS5 dengan rotasi per batch.

### 2.3 Non-Tujuan

- Menjadi pengganti resmi WhatsApp Business API.
- Menjamin nomor tidak diblokir.
- Mendukung fitur WhatsApp di luar pengiriman pesan (status, panggilan, manajemen grup).
- Menyimpan data ke database (semua state berbasis file JSON).

---

## 3. Target Pengguna

| Persona | Kebutuhan |
|---------|-----------|
| **Developer testing** | Menguji alur pengiriman massal tanpa menulis kode Baileys dari nol |
| **Admin internal** | Mengirim notifikasi ke banyak pihak (risiko ditanggung sendiri) |
| **Pengguna Termux** | Menjalankan tools ringan di HP Android tanpa compile dependency native |

---

## 4. User Journey

### 4.1 Instalasi Pertama Kali

1. User clone repo
2. User menjalankan `bash install.sh`
3. Installer memeriksa Node 20+, memasang dependency, membuat folder kerja, mendaftarkan perintah `wabulk`
4. User menjalankan `wabulk` → banner + peringatan risiko + menu utama

### 4.2 Tautkan Akun

1. Pilih "Tautkan Akun WhatsApp"
2. Pilih metode (QR / Pairing Code)
3. Scan QR atau masukkan 8 digit pairing code di HP
4. Session tersimpan di `auth_info/` (otomatis terhubung lagi pada startup berikutnya)
5. Kembali ke menu utama dengan status *tersambung*

### 4.3 Kirim Bulk Pesan

1. Pilih "Mulai Bulk Pesan"
2. Pilih sumber nomor (file `.txt` / input manual)
3. Pilih tipe pesan (teks / gambar / video / dokumen) dan isi pesan/caption
4. Lihat preview untuk beberapa penerima + contoh variasi spintax
5. Konfirmasi ringkasan (jumlah, jeda, dry run, proxy, estimasi durasi)
6. (Opsional) validasi nomor bila `dryRun` aktif, lalu pilih lanjut ke nomor valid saja
7. Proses berjalan dengan progress indicator; `Ctrl+C` menghentikan dengan rapi
8. Ringkasan hasil + log tersimpan di `logs/`

### 4.4 Ubah Pengaturan / Kelihat Riwayat

1. Menu **Pengaturan** → ubah `perBatch`, `jeda`, `jedaMin/Max`, `dryRun`, `logRetensi`, proxy
2. Konfigurasi tersimpan ke `config/settings.json` dan langsung dipakai sesi berikutnya
3. Menu **Lihat Riwayat** → daftar sesi → pilih sesi untuk melihat rincian per nomor

---

## 5. Fitur Fungsional

### F1 — Autentikasi

- **F1.1** Tautkan via QR Code (ditampilkan di terminal dengan `qrcode-terminal`)
- **F1.2** Tautkan via Pairing Code 8 digit (`requestPairingCode`)
- **F1.3** Simpan session di `auth_info/` (`useMultiFileAuthState`)
- **F1.4** Deteksi session valid saat startup + auto-connect
- **F1.5** Auto-reconnect saat koneksi terputus (kecuali `loggedOut` / `connectionReplaced`), maksimum 5 percobaan dengan backoff
- **F1.6** Logout & hapus session dari dalam menu
- **F1.7** Cache pesan terkirim di memori (LRU 500 entri, TTL 20 menit) + callback `getMessage`
  agar permintaan kirim ulang (*retry receipt*) dari penerima dapat dilayani. Tanpa ini,
  penerima bisa selamanya melihat "Menunggu pesan ini. Ini mungkin membutuhkan waktu beberapa saat."
- **F1.8** Pramuat sesi Signal (`assertSessions(jid, true)`) sebelum pengiriman ke nomor baru

### F2 — Bulk Pesan

- **F2.1** Sumber nomor dari file `.txt` (satu per baris)
- **F2.2** Sumber nomor dari input manual (satu entri per baris; koma untuk memisah beberapa nomor atau format `nomor,nama`)
- **F2.3** Format file mendukung `nomor,nama` untuk personalisasi
- **F2.4** Jeda batch: setiap N nomor, jeda M menit (default 15/15), dengan hitung mundur
- **F2.5** Jeda acak antar nomor (default 5–10 detik)
- **F2.6** Progress indicator real-time dengan `ora` (batch, posisi, sukses/gagal)
- **F2.7** Ringkasan hasil akhir (terkirim, gagal, persentase, durasi, contoh kegagalan)
- **F2.8** Satu kali percobaan ulang otomatis bila koneksi sempat putus
- **F2.9** Duplikat nomor otomatis dibuang; baris tidak valid dilaporkan
- **F2.10** Tujuan kirim selalu memakai JID asli (nomor telepon / grup). JID `@lid` yang
  dikembalikan `onWhatsApp` hanya disimpan sebagai metadata agar tidak memicu masalah dekripsi

### F3 — Template Pesan

- **F3.1** Variabel `{{nama}}` (dan `{{nomor}}`, `{{index}}`, `{{total}}`, `{{tanggal}}`, `{{jam}}`, `{{jid}}`)
- **F3.2** Spintax `{opsi1|opsi2}` dipilih acak per penerima
- **F3.3** Spintax bersarang didukung (`{Halo {Bapak|Ibu}|Hai}`)
- **F3.4** Preview pesan sebelum kirim + contoh variasi spintax
- **F3.5** Validasi template (kurung tidak seimbang, variabel tak dikenal) sebagai peringatan

### F4 — Media

- **F4.1** Gambar: `.jpg`, `.jpeg`, `.png`, `.webp` (maks 16 MB)
- **F4.2** Video: `.mp4`, `.mkv` (maks 64 MB)
- **F4.3** Dokumen: `.pdf`, `.docx`, `.xlsx`, `.zip` (maks 100 MB)
- **F4.4** Caption opsional dengan template & spintax
- **F4.5** Validasi berkas (ada, ekstensi didukung, tidak kosong, ukuran wajar) sebelum kirim

### F5 — Dry Run

- **F5.1** Validasi nomor via `onWhatsApp`
- **F5.2** Laporan nomor valid vs tidak valid (+ jumlah grup yang dilewati)
- **F5.3** Simpan hasil ke `logs/<waktu>_dryrun.json`
- **F5.4** Integrasi ke alur bulk: kirim hanya ke nomor valid (setelah konfirmasi)

### F6 — Log & Riwayat

- **F6.1** Setiap sesi bulk tercatat di `logs/` sebagai JSON lengkap dengan rincian per nomor
- **F6.2** Menu "Lihat Riwayat" menampilkan daftar sesi + detail per nomor
- **F6.3** Auto-hapus log lebih lama dari `logRetensi` hari (saat startup, dan manual dari menu)
- **F6.4** Log tetap disimpan bila pengguna menghentikan proses di tengah jalan (ditandai `dibatalkan: true`)

### F7 — Pengaturan

- **F7.1** Menu interaktif untuk mengubah konfigurasi (numerik, boolean, proxy)
- **F7.2** Simpan ke `config/settings.json`
- **F7.3** Load konfigurasi saat startup + koreksi otomatis nilai tidak valid
- **F7.4** Cadangkan file rusak ke `settings.json.bak` lalu buat ulang

### F8 — Proxy

- **F8.1** Dukungan HTTP(S) & SOCKS4/5 (`https-proxy-agent`, `socks-proxy-agent`)
- **F8.2** Rotasi proxy per batch (round-robin) melalui reconnect socket
- **F8.3** Konfigurasi via `settings.json` dan/atau submenu Pengaturan
- **F8.4** Kegagalan proxy tidak menghentikan proses (fallback + peringatan)

### F9 — Diagnosa Pengiriman

- **F9.1** Kirim satu pesan uji (default ke nomor akun sendiri, atau nomor lain bila diisi)
- **F9.2** Pantau status ack (`SERVER_ACK` → `DELIVERY_ACK` → `READ`) secara real-time via
  event `messages.update` yang diteruskan `KlienWhatsApp` (EventEmitter)
- **F9.3** Laporkan jumlah permintaan kirim ulang (retry) yang berhasil dilayani sebagai
  bukti mekanisme anti "Menunggu pesan ini" bekerja
- **F9.4** Berikan catatan & rekomendasi otomatis sesuai hasil (mis. belum ada ack → saran re-link)
- **F9.5** Simpan hasil ke `logs/<waktu>_diagnosa.json` + tampilkan dari menu Riwayat

---

## 6. Fitur Non-Fungsional

| Kategori | Requirement | Status |
|----------|-------------|--------|
| **Platform** | Termux, Linux, macOS, Windows (WSL / Git Bash) | ✅ path dihitung dari `import.meta.url`, tanpa dependency native |
| **Runtime** | Node.js ≥ 20 (disesuaikan dari rencana awal ≥18) | ✅ dicek di `bin/wabulk.js` & `install.sh` |
| **Modul** | ESM (`"type": "module"`) konsisten | ✅ |
| **Bahasa UI** | Indonesia | ✅ termasuk pesan error & log |
| **Konfigurasi** | File-based (`settings.json`), tanpa database | ✅ |
| **Log** | Format JSON, mudah dibaca mesin | ✅ |
| **Keamanan** | `auth_info/`, `logs/`, `config/settings.json` di `.gitignore` | ✅ |
| **Waktu startup** | Menu muncul < 3 detik | ✅ pemuatan config sinkron sederhana |
| **Ketahanan** | Satu menu error tidak menjatuhkan aplikasi | ✅ try/catch per alur menu + handler global |
| **Keandalan kirim** | Pesan yang gagal didekripsi penerima harus bisa dikirim ulang otomatis | ✅ `getMessage` + cache pesan (LRU/TTL) + pramuat sesi |
| **Ctrl+C** | Berhenti rapi tanpa merusak session | ✅ `SIGINT` handler + token pembatalan |
| **Rilis dependency** | Semua versi di-pin (tanpa `^`) | ✅ `package.json` |

---

## 7. Arsitektur Teknis

### 7.1 Stack & Versi Ter-pin

| Komponen | Versi |
|----------|-------|
| `@whiskeysockets/baileys` | 6.7.24 |
| `chalk` | 4.1.2 (CommonJS, dipilih agar stabil di ESM) |
| `prompts` | 2.4.2 |
| `qrcode-terminal` | 0.12.0 |
| `ora` | 9.4.1 |
| `pino` | 9.14.0 (level `silent`) |
| `https-proxy-agent` | 9.1.0 |
| `socks-proxy-agent` | 10.1.0 |

Tidak ada dependency native yang butuh kompilasi → aman di Termux.

### 7.2 Struktur Modul

```
bin/wabulk.js       → entry point (cek Node, folder, SIGINT, error global)
src/ui.js           → seluruh menu interaktif
src/auth.js         → KlienWhatsApp: QR/pairing, session, auto-reconnect, gantiProxy
src/sender.js       → bulk: loop, jeda batch, jeda acak, progress, ringkasan
src/template.js     → render variabel & spintax bersarang, preview
src/media.js        → deteksi tipe, validasi, bangun payload media (Buffer)
src/dryrun.js       → validasi nomor + laporan + simpan hasil
src/diagnosa.js     → cek kesehatan pengiriman (status ack + retry yang dilayani)
src/logger.js       → log JSON, riwayat, retensi otomatis
src/proxy.js        → parse proxy, RotatorProxy, buatAgent
src/config.js       → baca/tulis settings.json + validasi tipe
src/utils.js        → helper nomor/JID, waktu, file I/O, sinyal pembatalan
scripts/smoke.js    → uji mandiri tanpa jaringan
```

### 7.3 Alur Data

```
User → CLI (ui.js)
     → Tautkan Akun        → auth.js (QR / pairing) → auth_info/
     → Mulai Bulk Pesan    → utils.js (parse nomor)
                            → template.js (preview & render)
                            → media.js (jika media)
                            → dryrun.js (jika dryRun aktif)
                            → sender.js (loop + jeda + progress)
                                  ├── proxy.js  (rotasi per batch → auth.gantiProxy)
                                  ├── template.render() per penerima
                                  └── logger.simpanLog('bulk', hasil)
     → Mode Dry Run        → dryrun.js → logger.simpanLog('dryrun', hasil)
     → Pengaturan          → config.js  → config/settings.json
     → Lihat Riwayat       → logger.js  → logs/*.json
```

### 7.4 Keputusan Desain Penting

1. **ESM penuh** karena Baileys 6.7.x adalah ESM-only; library CommonJS diimpor lewat
   interop default (`import chalk from 'chalk'`).
2. **Root project dihitung dari `import.meta.url`**, bukan `process.cwd()`, sehingga
   perintah global `wabulk` (via `npm link`) tetap menemukan `auth_info/`, `logs/`,
   dan `config/` yang benar.
3. **Media dibaca sebagai Buffer**, bukan URL `file://`, karena `file://` tidak
   konsisten di Termux.
4. **Konfigurasi memaafkan (self-healing)**: nilai tidak valid dikoreksi + dilaporkan,
   file rusak dicadangkan, aplikasi tidak pernah gagal jalan karena setting.
5. **Rotasi proxy = reconnect socket** (session tetap tersimpan) karena Baileys
   menetapkan agent saat socket dibuat.
6. **Satu error di dalam menu tidak menutup aplikasi**; error fatal hanya untuk
   kegagalan dependency/Node.
7. **`getMessage` wajib diisi**: retry dari penerima hanya bisa dilayani bila Baileys dapat
   mengambil kembali isi pesan yang pernah dikirim. Callback ini mengembalikan **konten pesan
   (`proto.IMessage`)**, bukan objek `WAMessage` penuh — kesalahan yang membuat retry gagal
   secara senyap. Karena itu wabulk menyimpan pesan terkirim di memori selama proses berjalan.
8. **Debug opsional**: `WABULK_DEBUG=1` menaikkan level logger pino dari `silent` ke `debug`
   untuk diagnosa, tanpa menambah dependency baru.

---

## 8. Metrik Keberhasilan

| Metrik | Target | Cara verifikasi |
|--------|--------|-----------------|
| Waktu instalasi | < 2 menit | `install.sh` pada koneksi 10 Mbps |
| Waktu dari `wabulk` sampai menu | < 3 detik | pengukuran manual |
| Tingkat keberhasilan kirim (nomor valid) | > 95% | ringkasan hasil + log |
| Crash rate | < 1% per sesi | handler global + try/catch per alur |
| Uji mandiri | 100% lulus | `npm run smoke` (67 pemeriksaan, tanpa jaringan) |

---

## 9. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Nomor diblokir WhatsApp | Tinggi | Peringatan di README, banner startup, dan ringkasan sebelum kirim; anjuran nomor sekali pakai |
| Baileys breaking change | Sedang | Versi di-pin (6.7.24); upgrade diuji lewat `npm run smoke` |
| Session corrupt | Sedang | Pesan error spesifik + menu Logout/reset; FAQ di README |
| Koneksi terputus | Rendah | Auto-reconnect (maks 5x, backoff), 1x retry per pesan |
| File nomor besar (>10k) | Rendah | Baris dibaca sekali, duplikat dibuang, progress per nomor |
| Proxy mati di tengah sesi | Sedang | Fallback ke proxy sebelumnya + lanjutkan pengiriman |
| Config rusak | Rendah | Cadangkan ke `.bak`, pakai default, laporkan peringatan |
| Media terlalu besar (RAM Termux) | Sedang | Batas ukuran per kategori (16/64/100 MB) |
| Penerima gagal mendekripsi pesan pertama ("Menunggu pesan ini") | Tinggi | `getMessage` + cache pesan terkirim (retry), pramuat sesi, tetap pakai JID non-`@lid`, panduan re-link di README |

---

## 10. Roadmap

### v1.0 (MVP — selesai pada dokumen ini)

- Autentikasi QR & pairing code + auto-reconnect
- Bulk teks & media dengan jeda batch + jeda acak
- Template & spintax (termasuk bersarang)
- Dry run, log & riwayat, pengaturan interaktif, proxy + rotasi per batch
- Dokumentasi lengkap (README, PRD) + uji mandiri `npm run smoke`

### v1.1 (rencana)

- Mode **resume**: lanjutkan sesi dari log yang belum selesai
- Ekspor riwayat ke CSV/Excel
- Mode non-interaktif (flag CLI: `wabulk send --file nomor.txt --msg "..."`)

### v1.2 (rencana)

- Statistik pengiriman lintas sesi (grafik ASCII)
- Rotasi pesan (banyak template per batch)
- Pemeriksaan berkala kesehatan proxy

### v2.0 (ide)

- GUI lokal (web) di atas core yang sama
- Multi-akun (folder `auth_info` terpisah)
- Penjadwalan (cron internal) & pengiriman terjadwal

---

## 11. Kriteria Penerimaan

### v1.0 (semua tercapai)

- [x] `git clone` + `install.sh` + `wabulk` berjalan tanpa error
- [x] QR dan pairing code berfungsi (handler `connection.update` + `requestPairingCode`)
- [x] Bulk berjalan dengan jeda batch & jeda acak, progress `ora`, dapat dihentikan `Ctrl+C`
- [x] Log tersimpan di `logs/` (bulk & dry run) + retensi otomatis
- [x] Pengaturan tersimpan & ter-load dari `config/settings.json`
- [x] Template `{{nama}}` + spintax (bersarang) berfungsi
- [x] Kirim gambar, video, dokumen dengan caption dinamis
- [x] Dry run melaporkan valid/tidak valid dan menyimpan hasil
- [x] Menu riwayat menampilkan sesi sebelumnya + rincian per nomor
- [x] Proxy HTTP & SOCKS5 + rotasi per batch
- [x] `npm run check` dan `npm run smoke` lulus tanpa jaringan
- [x] Pengiriman pulih otomatis saat penerima meminta kirim ulang (`getMessage` + cache retry,
      terverifikasi lewat uji `npm run smoke` dan inspeksi kode Baileys `messages-recv.js`)
- [x] Menu diagnosa melaporkan status ack pesan uji + jumlah retry yang dilayani

---

## 12. Pertanyaan Terbuka

1. Apakah perlu dukungan multi-bahasa (ID/EN) di CLI? **Sementara: Bahasa Indonesia saja.**
2. Apakah perlu mode "resume" jika proses terhenti di tengah batch? **Masuk roadmap v1.1.**
3. Apakah perlu integrasi Google Sheets sebagai sumber nomor? **Belum — tambah kompleksitas autentikasi OAuth.**
4. Strategi distribusi: npm registry, GitHub release, atau keduanya? **Sementara distribusi GitHub (clone + `install.sh`).**

---

## 13. Disclaimer Hukum

wabulk menggunakan Baileys, library tidak resmi yang melanggar Ketentuan Layanan WhatsApp. Penggunaan tools ini dapat menyebabkan pemblokiran nomor permanen. Pengguna bertanggung jawab penuh atas risiko hukum dan teknis. Untuk penggunaan komersial, wajib beralih ke WhatsApp Business Cloud API resmi.
