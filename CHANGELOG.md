# Changelog

Semua perubahan penting di project ini dicatat di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/), dan versi mengikuti [Semantic Versioning](https://semver.org/lang/id/).

## [Unreleased]

### Ditambahkan

- `CHANGELOG.md`.
- README: tabel konfigurasi `.env` (termasuk `HOST`), struktur file, daftar route server, daftar endpoint MAL, dan bagian keamanan.

### Diperbaiki

- `.gitignore` sekarang mengabaikan `MAL-Key.txt` (berisi Client ID/Secret dalam bentuk teks biasa), varian `.env.*` (kecuali `.env.example`), file log, file OS, dan folder editor.

## [1.0.0] - 2026-10-23

### Ditambahkan

- Playground lokal untuk MyAnimeList API v2 tanpa dependency (Node.js 21.7+).
- Proxy `POST /api/request` di `server.js` supaya Client Secret dan token tetap di server (API MAL tidak mendukung CORS).
- Login OAuth2 Authorization Code + PKCE `plain` lewat popup, dengan fallback redirect halaman penuh kalau popup diblokir.
- Token disimpan di `.mal-token.json` dan di-refresh otomatis saat hampir expire atau saat MAL membalas 401.
- Pengecekan Client ID + redirect URI ke MAL saat start dan sebelum login, dengan pesan error yang bisa dibaca.
- Katalog endpoint Anime, Manga, User, dan Forum di `public/endpoints.js`.
- Mode auth `auto` / `Client ID` / `User token`.
- Tampilan response: preview kartu/detail, JSON, header, serta snippet cURL dan fetch.
- Konfirmasi sebelum mengirim request PATCH/DELETE yang mengubah list MAL.
