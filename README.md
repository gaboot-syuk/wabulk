# wabulk

CLI interaktif untuk bulk pesan WhatsApp, dibangun di atas [Baileys](https://github.com/WhiskeySockets/Baileys). Cukup clone, install, dan jalankan — tanpa perlu menyentuh kode Baileys secara langsung.

> ⚠️ **Peringatan**: wabulk menggunakan library tidak resmi (Baileys) yang melanggar [Ketentuan Layanan WhatsApp](https://www.whatsapp.com/legal/messaging-guidelines). Pengiriman massal dapat menyebabkan nomor Anda **diblokir permanen tanpa jalur banding**. Gunakan hanya untuk testing dengan nomor sekali pakai. Untuk kebutuhan bisnis, gunakan [WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api) resmi.

---

## Daftar Isi

- [Fitur](#fitur)
- [Persyaratan](#persyaratan)
- [Instalasi](#instalasi)
- [Penggunaan](#penggunaan)
- [Struktur Project](#struktur-project)
- [Konfigurasi](#konfigurasi)
- [Template Pesan](#template-pesan)
- [Media](#media)
- [Mode Dry Run](#mode-dry-run)
- [Cek Kesehatan Pengiriman](#cek-kesehatan-pengiriman-diagnosa)
- [Log & Riwayat](#log--riwayat)
- [Proxy](#proxy)
- [Format File Nomor](#format-file-nomor)
- [Pengujian & QA](#pengujian--qa)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Batasan yang Diketahui](#batasan-yang-diketahui)
- [Kontribusi](#kontribusi)
- [Lisensi](#lisensi)

---

## Fitur

- **Tautkan akun** via QR Code atau Pairing Code (8 digit)
- **Auto-reconnect** saat koneksi terputus (kecuali logout / sesi digantikan)
- **Anti "Menunggu pesan ini"**: cache pesan terkirim untuk melayani permintaan kirim ulang (retry) + pramuat sesi enkripsi sebelum kirim
- **Bulk pesan** dengan jeda otomatis per batch (default: 15 nomor / 15 menit)
- **Jeda acak** antar nomor (5–10 detik) untuk menghindari pola kaku
- **Template pesan** dengan variabel `{{nama}}` dan spintax `{Halo|Hai}`
- **Spintax bersarang** didukung: `{Halo {Bapak|Ibu}|Hai}`
- **Dukungan media**: gambar, video, dan dokumen
- **Mode dry run** — validasi nomor tanpa mengirim pesan
- **Cek kesehatan pengiriman (diagnosa)** — kirim 1 pesan uji lalu pantau status ack-nya
  (`SERVER_ACK` → `DELIVERY_ACK` → `READ`) beserta berapa kali mekanisme retry dipakai
- **Log & riwayat** pengiriman tersimpan otomatis + retensi otomatis
- **Proxy HTTP & SOCKS5** dengan rotasi per batch (opsional)
- **Pengaturan interaktif** yang tersimpan di `config/settings.json`
- **Cross-platform**: Termux, Linux, macOS, Windows (WSL / Git Bash)

---

## Persyaratan

- **Node.js** v20 atau lebih baru
- **npm** v9 atau lebih baru
- **Git**
- Koneksi internet stabil

> ℹ️ **Catatan versi Node**: Baileys 6.7.x beserta library pendukungnya
> (`https-proxy-agent`, `socks-proxy-agent`, `ora`) memerlukan Node.js 20+.
> Node.js 18 sudah *end-of-life* sejak April 2025, jadi wabulk memakai Node 20+
> agar dependency tetap aman dan terpelihara.

Cek versi:

```bash
node -v   # harus v20.x atau lebih baru
npm -v
```

---

## Instalasi

### Linux / macOS / Termux

```bash
git clone https://github.com/username/wabulk.git
cd wabulk
bash install.sh
```

`install.sh` akan:

1. Mendeteksi platform (Termux / Linux / macOS / WSL)
2. Memastikan Node.js v20+ tersedia
3. Install dependency via `npm install`
4. Membuat folder `config/`, `auth_info/`, `logs/`, dan `examples/`
5. Menjalankan pemeriksaan sintaks (`npm run check`)
6. Register command `wabulk` secara global via `npm link`

Ada dua opsi tambahan:

```bash
bash install.sh --tanpa-link   # install saja, jalankan dengan `npm start`
bash install.sh --bantu        # tampilkan bantuan
```

### Termux (khusus Android)

```bash
pkg update && pkg upgrade
pkg install nodejs-lts git tmux
git clone https://github.com/username/wabulk.git
cd wabulk
bash install.sh
```

Disarankan menjalankan di dalam `tmux` agar tetap hidup saat Termux di-background:

```bash
tmux
wabulk
# Ctrl+B lalu D untuk keluar (proses tetap jalan)
```

### Windows

Gunakan **WSL2** (disarankan) atau **Git Bash**:

```bash
git clone https://github.com/username/wabulk.git
cd wabulk
npm install
npm start
```

---

## Penggunaan

Setelah instalasi selesai, jalankan:

```bash
wabulk
```

Atau tanpa `npm link`:

```bash
npm start
```

Anda akan masuk ke menu utama:

```
? Menu Utama
❯ Tautkan Akun WhatsApp
  Mulai Bulk Pesan
  Mode Dry Run (validasi nomor)
  Cek Kesehatan Pengiriman (diagnosa)
  Pengaturan
  Lihat Riwayat
  Bantuan & Disclaimer
  Keluar
```

### 1. Tautkan Akun WhatsApp

Pilih **Tautkan Akun WhatsApp**, lalu pilih metode:

- **QR Code** — scan dengan WhatsApp di HP (Setelan → Perangkat Tertaut → Tautkan Perangkat)
- **Pairing Code** — masukkan nomor telepon, lalu masukkan 8 digit kode di HP
  (Setelan → Perangkat Tertaut → **Tautkan dengan nomor telepon**)
- **Logout & hapus sesi** — memutus tautan dan menghapus `auth_info/`

Session tersimpan di `auth_info/`. Anda tidak perlu scan ulang selama session valid —
wabulk juga otomatis mencoba menyambung saat aplikasi dibuka.

### 2. Mulai Bulk Pesan

Alur:

1. Pilih sumber nomor: **file .txt** atau **input manual**
2. Pilih tipe pesan: **Teks / Gambar / Video / Dokumen**
3. Tulis pesan (baris demi baris; isi caption bila memakai media)
4. Lihat **preview** untuk beberapa penerima pertama
5. Konfirmasi ringkasan (termasuk estimasi durasi)
6. Proses berjalan dengan progress indicator + kemampuan dihentikan dengan `Ctrl+C`

Bila `dryRun` diaktifkan pada Pengaturan, wabulk otomatis memvalidasi semua nomor
terlebih dahulu, menampilkan daftar valid/tidak valid, lalu menanyakan apakah
pengiriman dilanjutkan **hanya ke nomor valid**.

### 3. Mode Dry Run

Menu terpisah untuk memeriksa daftar nomor saja (tanpa kirim pesan).
Hasil disimpan ke `logs/<waktu>_dryrun.json`.

### 4. Pengaturan

Menu **Pengaturan** menyimpan konfigurasi ke `config/settings.json`:

| Opsi | Default | Deskripsi |
|------|---------|-----------|
| `perBatch` | 15 | Jumlah nomor per batch |
| `jeda` | 15 | Jeda antar batch (menit) |
| `jedaMin` | 5 | Jeda acak minimum antar nomor (detik) |
| `jedaMax` | 10 | Jeda acak maksimum antar nomor (detik) |
| `dryRun` | false | Validasi nomor sebelum kirim |
| `prewarmSesi` | true | Siapkan sesi enkripsi (Signal) sebelum kirim — mencegah pesan tertahan di penerima |
| `logRetensi` | 30 | Retensi log (hari) |
| `proxy` | null | Pengaturan proxy (lihat [Proxy](#proxy)) |

Nilai yang tidak valid akan dikoreksi otomatis dan diberi peringatan — konfigurasi
rusak tidak akan membuat aplikasi gagal jalan.

### 5. Lihat Riwayat

Menampilkan daftar sesi dari folder `logs/`, lengkap dengan ringkasan. Pilih satu sesi
untuk melihat rincian per nomor (status, waktu, alasan gagal). Menu ini juga menyediakan
"Bersihkan log lama sekarang" (memakai `logRetensi`).

---

## Struktur Project

```
wabulk/
├── bin/
│   └── wabulk.js           # entry point CLI (shebang + SIGINT handling)
├── src/
│   ├── auth.js             # QR & pairing code, session, auto-reconnect, retry cache
│   ├── sender.js           # logika bulk + jeda batch/jeda acak + progress
│   ├── template.js         # render variabel & spintax bersarang
│   ├── media.js            # deteksi & validasi media, bangun payload
│   ├── dryrun.js           # validasi nomor via onWhatsApp + laporan
│   ├── diagnosa.js         # cek kesehatan pengiriman (status ack + retry)
│   ├── logger.js           # log JSON, riwayat, retensi otomatis
│   ├── proxy.js            # parser proxy + rotasi per batch
│   ├── config.js           # baca/tulis settings.json + validasi
│   ├── ui.js               # seluruh menu interaktif
│   └── utils.js            # helper umum (nomor, waktu, file, sinyal, label ack)
├── config/
│   └── settings.json       # setting user (gitignored, dibuat otomatis)
├── auth_info/              # session WhatsApp (gitignored)
├── logs/                   # riwayat pengiriman (gitignored)
├── examples/
│   └── nomor.txt           # contoh format daftar nomor
├── scripts/
│   └── smoke.js            # uji mandiri tanpa jaringan (`npm run smoke`)
├── install.sh
├── package.json
├── README.md
├── PRD.md
├── LICENSE
└── .gitignore
```

---

## Konfigurasi

File `config/settings.json` dibuat otomatis saat pertama kali dijalankan. Contoh isi:

```json
{
  "perBatch": 15,
  "jeda": 15,
  "jedaMin": 5,
  "jedaMax": 10,
  "dryRun": false,
  "prewarmSesi": true,
  "logRetensi": 30,
  "proxy": null
}
```

Bila file ini rusak (bukan JSON valid), wabulk akan mencadangkannya ke
`config/settings.json.bak` lalu membuat ulang dengan nilai default.

---

## Template Pesan

wabulk mendukung dua bentuk dinamis:

### 1. Variabel

Gunakan `{{nama}}` untuk personalisasi. Jika file nomor berisi format `nomor,nama`,
variabel akan terisi otomatis:

```
6281234567890,Budi
6281234567891,Siti
```

Contoh pesan:

```
Halo {{nama}}, ini pesan testing.
```

Hasil:

- Ke Budi: `Halo Budi, ini pesan testing.`
- Ke Siti: `Halo Siti, ini pesan testing.`

Variabel bawaan yang tersedia: `{{nomor}}`, `{{nama}}`, `{{jid}}`, `{{index}}`,
`{{total}}`, `{{tanggal}}`, `{{jam}}`. Variabel yang tidak dikenal akan dihapus
dari pesan (dan dilaporkan sebagai peringatan sebelum kirim).

### 2. Spintax

Gunakan `{opsi1|opsi2|opsi3}` agar setiap pesan bervariasi:

```
{Halo|Hai|Selamat pagi} {{nama}}, {apa kabar?|semoga sehat selalu}
```

Spintax bersarang juga didukung:

```
{Halo {Bapak|Ibu}|Hai} {{nama}}
```

Setiap penerima mendapat kombinasi acak. Sebelum kirim, wabulk menampilkan
beberapa contoh variasi agar Anda bisa memastikan hasilnya masuk akal.

---

## Media

Saat memasukkan pesan, pilih tipe:

```
? Tipe pesan:
❯ Teks
  Gambar (.jpg, .jpeg, .png, .webp)
  Video (.mp4, .mkv)
  Dokumen (.pdf, .docx, .xlsx, .zip)
```

Jika memilih media, Anda akan diminta path file (boleh `~/`, path relatif, atau absolut).
Caption opsional dan mendukung template serta spintax yang sama. Batas ukuran berkas:

| Tipe | Batas |
|------|-------|
| Gambar | 16 MB |
| Video | 64 MB |
| Dokumen | 100 MB |

---

## Mode Dry Run

Aktifkan `dryRun: true` di pengaturan (atau pakai menu **Mode Dry Run**). wabulk akan:

1. Cek apakah nomor terdaftar di WhatsApp (`onWhatsApp`)
2. Menampilkan daftar nomor valid dan tidak valid
3. Menyimpan hasil ke `logs/<waktu>_dryrun.json`

Berguna untuk membersihkan daftar nomor sebelum pengiriman sesungguhnya.
JID grup (`...@g.us`) otomatis dilewati dari validasi dan dianggap siap kirim
(WhatsApp tidak menyediakan pengecekan keanggotaan grup via `onWhatsApp`).

---

## Cek Kesehatan Pengiriman (Diagnosa)

Menu **Cek Kesehatan Pengiriman** mengirim **satu pesan uji** (default ke nomor akun Anda
sendiri, atau nomor lain bila diisi) lalu memantau status pengirimannya:

| Status | Arti |
|--------|------|
| `PENDING` | Belum keluar dari perangkat |
| `SERVER_ACK` | Diterima server WhatsApp |
| `DELIVERY_ACK` | Sampai perangkat penerima |
| `READ` | Dibaca penerima (tujuan = nomor sendiri: perlu Anda buka chat-nya) |

Laporan juga menampilkan **berapa permintaan kirim ulang (retry) yang berhasil dilayani**.
Angka retry > 0 justru kabar baik: artinya penerima sempat gagal mendekripsi dan wabulk
berhasil mengirim ulang otomatis — mekanisme anti "Menunggu pesan ini" terbukti bekerja.

Hasil disimpan ke `logs/<waktu>_diagnosa.json` dan bisa dibuka lagi dari menu **Lihat Riwayat**.

---

## Log & Riwayat

Setiap sesi bulk otomatis tercatat di `logs/`:

```
logs/
├── 2026-09-24T10-30-00_bulk.json
├── 2026-09-24T14-00-00_dryrun.json├── 2026-09-24T10-40-00_diagnosa.json└── ...
```

Format log bulk:

```json
{
  "tipe": "bulk",
  "timestamp": "2026-09-24T10:30:00.000Z",
  "sumber": "file nomor.txt",
  "tipePesan": "teks",
  "media": null,
  "totalDiminta": 150,
  "total": 150,
  "terkirim": 148,
  "gagal": 2,
  "perBatch": 15,
  "jeda": 15,
  "jedaMin": 5,
  "jedaMax": 10,
  "durasi": "2j 30m 12d",
  "dibatalkan": false,
  "validasi": { "valid": 149, "tidakValid": 1, "grup": 0 },
  "detail": [
    { "nomor": "6281234567890", "nama": "Budi", "jid": "6281234567890@s.whatsapp.net", "status": "sent", "waktu": "..." },
    { "nomor": "6281234567891", "nama": "Siti", "jid": "6281234567891@s.whatsapp.net", "status": "failed", "error": "..." }
  ]
}
```

Log lebih lama dari `logRetensi` hari dihapus otomatis **saat startup**.

---

## Proxy

Proxy berguna untuk menyebar trafik keluar. Format proxy yang didukung:

```
host:port
user:pass@host:port
http://user:pass@host:port
socks5://user:pass@host:port
```

Contoh isi `config/settings.json`:

```json
{
  "proxy": {
    "enabled": true,
    "list": [
      "http://user:pass@host1:8080",
      "socks5://user:pass@host2:1080"
    ],
    "rotatePerBatch": true
  }
}
```

Jika `rotatePerBatch: true`, setiap batch baru akan memakai proxy berikutnya
(round-robin). Pergantian proxy dilakukan dengan menyambung ulang socket WhatsApp
(session tetap tersimpan sehingga tidak perlu scan ulang). Bila pergantian gagal,
wabulk tetap melanjutkan pengiriman dengan proxy sebelumnya dan mencatat peringatan.

Proxy juga bisa dikelola lewat menu **Pengaturan → Proxy**.

---

## Format File Nomor

```
# komentar diawali tanda #
6281234567890,Budi
6281234567891,Siti
081234567892
+62 812-3456-7893,Rina
120363012345678901@g.us,Grup Kelas
```

- Satu entri per baris
- `nomor,nama` → mengisi `{{nama}}`
- `08xx`, `+62xx`, `628xx` semuanya diterima dan dirapikan otomatis
- Nomor duplikat otomatis dibuang
- Baris tidak valid dilaporkan (mis. nomor terlalu pendek) dan dilewati
- JID grup bisa ditulis apa adanya

---

## Pengujian & QA

```bash
npm run check   # node --check untuk semua file (tanpa eksekusi)
npm run smoke   # uji mandiri tanpa jaringan: utils, template, media, proxy, config,
                # logger, dry run, diagnosa & loop sender (semua pakai socket palsu)
```

`npm run smoke` tidak menghubungi WhatsApp sama sekali — cocok untuk CI.

Untuk menelusuri masalah pengiriman, jalankan dengan log debug Baileys aktif:

```bash
WABULK_DEBUG=1 npm start
```

Log debug ini (level `debug` dari pino) menampilkan lalu lintas node WhatsApp, termasuk
permintaan kirim ulang (`retry receipt`) dari penerima — berguna untuk memastikan mekanisme
retry berjalan.

---

## Troubleshooting

**`npm link` gagal saat install**
Jalankan `npm start` sebagai alternatif, atau perbaiki izin folder global npm:

```bash
npm config get prefix
# bila folder tersebut milik root, gunakan nvm atau atur prefix ke folder user
```

**Waktu habis menunggu koneksi WhatsApp**
Cek koneksi internet, matikan VPN/proxy sementara, lalu coba lagi. Bila memakai
proxy, pastikan format dan kredensialnya benar (menu **Pengaturan → Proxy**).

**"Sesi logout dari perangkat lain"**
Sesi di `auth_info/` tidak lagi valid. Pilih **Tautkan Akun WhatsApp → Logout & hapus sesi**,
lalu tautkan ulang dengan QR/pairing code.

**Pesan sampai tetapi penerima melihat "Menunggu pesan ini. Ini mungkin membutuhkan waktu beberapa saat."**

Artinya *envelope* pesan sampai ke penerima, tetapi isinya gagal didekripsi pada percobaan
pertama. Ini hal yang wajar saat sesi enkripsi (Signal) baru dibentuk — sering terjadi pada
kontak yang memakai alamat `@lid` dan pada perangkat iPhone. WhatsApp lalu meminta pengirim
mengirim ulang pesan tersebut lewat mekanisme *retry receipt*.

wabulk sudah menangani ini (`getMessage` + cache pesan terkirim + pramuat sesi), tetapi bila
masih terjadi:

1. Pastikan dependency terbaru: `npm install`
2. Putuskan perangkat tertaut lain yang tidak dipakai (WhatsApp → Perangkat Tertaut)
3. Menu **Tautkan Akun WhatsApp → Logout & hapus sesi**, lalu tautkan ulang lewat QR
4. Pastikan **Pengaturan → Pramuat sesi enkripsi sebelum kirim** berstatus *aktif*
5. Kirim ulang. Pesan yang sudah tertahan sebelumnya tidak bisa diperbaiki otomatis
6. Bila masih gagal, jalankan `WABULK_DEBUG=1 npm start` dan periksa log Baileys
   (cari kata `retry` / `decrypt`)

**Pesan gagal terkirim semua**
Pastikan sesi masih aktif (status di menu utama harus *tersambung*), nomor valid
(coba **Mode Dry Run**), dan Anda tidak sedang dibatasi WhatsApp.

---

## FAQ

**Q: Apakah nomor saya pasti aman?**
A: Tidak. wabulk hanya mengurangi risiko, bukan menghilangkan. Gunakan nomor sekali pakai.

**Q: Berapa lama session bertahan?**
A: Selama Anda tidak logout dari HP dan folder `auth_info/` tidak dihapus, session bisa
bertahan berbulan-bulan.

**Q: Kenapa pesan tidak terkirim?**
A: Cek koneksi, cek apakah nomor valid (Mode Dry Run), cek apakah sesi masih aktif.
Lihat rincian di menu **Lihat Riwayat**.

**Q: Bisa kirim ke grup?**
A: Bisa. Gunakan format JID grup (`123456789012345678@g.us`) di file nomor.
Akun harus sudah menjadi anggota grup tersebut.

**Q: Apakah bisa dijalankan 24/7?**
A: Bisa, jalankan di VPS atau Termux dengan `tmux`. Tapi ingat risiko pemblokiran.

**Q: Bagaimana cara reset session?**
A: Menu **Tautkan Akun WhatsApp → Logout & hapus sesi**, atau hapus folder `auth_info/`.

**Q: Bisa membatalkan proses di tengah jalan?**
A: Bisa, tekan `Ctrl+C` saat proses berjalan. Log sebagian tetap disimpan.

---

## Batasan yang Diketahui

- **Tidak ada resume otomatis**: bila proses terhenti (mati listrik/Ctrl+C), sesi harus
  dimulai dari awal. Daftar yang sudah dikirim bisa dilihat di `logs/`.
- **Rotasi proxy memutus koneksi**: pergantian proxy per batch memerlukan reconnect
  socket, jadi ada jeda beberapa detik di awal batch baru.
- **Dry run tidak bisa memvalidasi grup**: `onWhatsApp` hanya untuk nomor individu.
- **Satu akun per instance**: wabulk hanya mengelola satu folder `auth_info/` sekaligus.
  Untuk multi-akun, jalankan di folder project terpisah atau pakai `--prefix` npm.
- **Berkas media dibaca ke memori**: pengiriman video besar (>64 MB) memakai RAM yang
  lumayan; batas ukuran disediakan agar tidak kehabisan memori di HP/Termux.
- **Pesan yang sudah tertahan tidak bisa diperbaiki otomatis**: bila penerima sudah menampilkan
  "Menunggu pesan ini" sebelum Anda memperbarui wabulk, pesan tersebut perlu dikirim ulang.
- **Estimasi durasi di ringkasan bersifat perkiraan** (memakai nilai tengah jeda acak).
- **Baileys adalah library tidak resmi** — perubahan sepihak dari WhatsApp bisa membuat
  versi tertentu berhenti bekerja sampai dependency diperbarui.

---

## Kontribusi

Pull request diterima. Untuk perubahan besar, buka issue terlebih dahulu.

1. Fork repo
2. Buat branch fitur (`git checkout -b fitur/baru`)
3. Commit perubahan (`git commit -m 'Tambah fitur X'`)
4. Push (`git push origin fitur/baru`)
5. Buka Pull Request

Konvensi kode: ESM (`import`/`export`), 2 spasi, single quote, semicolon, tanpa TypeScript,
komentar singkat dalam Bahasa Indonesia pada bagian yang tidak obvious.

---

## Lisensi

MIT. Lihat `LICENSE`.

---

## Disclaimer

wabulk tidak berafiliasi dengan WhatsApp, Meta, atau Baileys. Penggunaan tools ini
sepenuhnya tanggung jawab pengguna. Penulis tidak bertanggung jawab atas pemblokiran
nomor, kehilangan data, atau kerugian lain yang timbul dari penggunaan wabulk.
