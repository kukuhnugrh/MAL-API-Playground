# MAL API Playground

Web lokal untuk testing [MyAnimeList API v2](https://myanimelist.net/apiconfig/references/api/v2): pilih endpoint, ubah parameter, kirim, lalu lihat hasilnya sebagai preview (kartu/detail), JSON, header, atau snippet cURL/fetch.

Tanpa dependency (tidak perlu `npm install`): cukup Node.js 21.7+ (butuh `process.loadEnvFile`).

## Setup

1. Buka <https://myanimelist.net/apiconfig>, buat/edit app kamu, lalu isi **App Redirect URL** persis:
   ```
   http://localhost:3000/oauth/callback
   ```
   Jangan `http://localhost/...` tanpa port: itu port 80 (di Windows biasanya dipegang IIS), jadi setelah Allow kamu malah nyasar ke halaman 404 IIS.
2. Salin `.env.example` jadi `.env`, lalu isi minimal `MAL_CLIENT_ID` dan `MAL_CLIENT_SECRET` (lihat [Konfigurasi](#konfigurasi)).
3. Jalankan:
   ```
   npm start        # atau: npm run dev (auto-restart saat server.js berubah)
   ```
4. Buka <http://localhost:3000>.

## Konfigurasi

Semua dibaca dari `.env`:

| Variabel | Wajib | Default | Keterangan |
| --- | --- | --- | --- |
| `MAL_CLIENT_ID` | ya | – | Client ID dari halaman apiconfig MAL. |
| `MAL_CLIENT_SECRET` | untuk login | – | Client Secret app MAL. Dibutuhkan untuk tukar/refresh token OAuth. |
| `MAL_REDIRECT_URI` | tidak | `http://localhost:<PORT>/oauth/callback` | Harus sama persis dengan App Redirect URL di MAL. |
| `PORT` | tidak | `3000` | Port server. Kalau diganti, App Redirect URL di MAL ikut diganti. |
| `HOST` | tidak | `127.0.0.1` | Alamat bind server. Default hanya bisa diakses dari mesin ini. |

## Struktur

```
server.js            Server HTTP: static file, proxy API, OAuth2 PKCE, penyimpanan token
public/index.html    Halaman playground
public/app.js        Logika UI: form request, preview, snippet cURL/fetch, link endpoint via #hash
public/endpoints.js  Katalog endpoint MAL + parameter default
public/style.css     Styling
.env.example         Template konfigurasi
```

Riwayat perubahan ada di [CHANGELOG.md](CHANGELOG.md).

## Cara kerja

```
Browser (public/)  →  server.js (localhost)  →  api.myanimelist.net/v2
```

- API MAL tidak bisa dipanggil langsung dari browser (tidak ada header CORS), dan Client Secret/token tidak boleh sampai ke frontend. Karena itu semua request lewat proxy `POST /api/request` di `server.js`.
- **Endpoint publik** (search, details, ranking, seasonal, forum, list user lain) cukup pakai header `X-MAL-CLIENT-ID`.
- **Endpoint user** (🔒: `@me`, suggestions, update/delete list) butuh login OAuth2. Klik **Login dengan MyAnimeList** → jendela popup MAL terbuka → klik **Allow** → popup tertutup sendiri dan playground langsung login (request yang tadi gagal karena belum login dikirim ulang otomatis). Kalau popup diblokir browser, login jalan lewat redirect halaman penuh. MAL hanya mendukung PKCE `plain`.
- Saat start dan sebelum login, server mengecek ke MAL apakah Client ID + redirect URI diterima. Kalau ditolak, alasannya muncul di sidebar/terminal, bukan halaman error JSON dari MAL.
- Token disimpan di `.mal-token.json`, jadi login tetap ada setelah restart. Token di-refresh otomatis saat hampir expire atau saat MAL membalas 401.
- Pilihan **Auth** di request bar: `auto` = pakai user token kalau sudah login, kalau belum pakai Client ID; `Client ID` / `User token` untuk memaksa salah satu.

### Route server

| Route | Fungsi |
| --- | --- |
| `GET /api/status` | Status konfigurasi, hasil cek OAuth, dan user yang login. |
| `POST /api/request` | Proxy request ke `api.myanimelist.net/v2`. |
| `GET /oauth/login` | Mulai login OAuth (`?popup` untuk mode popup). |
| `GET /oauth/callback` | Redirect URI OAuth (path mengikuti `MAL_REDIRECT_URI`). |
| `POST /oauth/refresh` | Paksa refresh token. |
| `POST /oauth/logout` | Hapus token tersimpan. |
| `GET /*` | File statis dari `public/`. |

## Endpoint yang tersedia

| Grup | Endpoint | Auth |
| --- | --- | --- |
| Anime | `GET /anime`, `GET /anime/{anime_id}`, `GET /anime/ranking`, `GET /anime/season/{year}/{season}` | publik |
| Anime | `GET /anime/suggestions`, `PATCH`/`DELETE /anime/{anime_id}/my_list_status` | user |
| Manga | `GET /manga`, `GET /manga/{manga_id}`, `GET /manga/ranking` | publik |
| Manga | `PATCH`/`DELETE /manga/{manga_id}/my_list_status` | user |
| User | `GET /users/@me` | user |
| User | `GET /users/{user_name}/animelist`, `GET /users/{user_name}/mangalist` | publik (`@me` butuh login) |
| Forum | `GET /forum/boards`, `GET /forum/topics`, `GET /forum/topic/{topic_id}` | publik |

Endpoint baru bisa ditambahkan di `public/endpoints.js`.

## Keamanan

- `.env`, `.mal-token.json`, dan `MAL-Key.txt` berisi kredensial dan sudah masuk `.gitignore`. Jangan commit file tersebut.
- Kalau Client Secret sempat bocor (ter-commit/ter-share), buat ulang di <https://myanimelist.net/apiconfig>.
- Server default bind ke `127.0.0.1`. Jangan ubah `HOST` ke `0.0.0.0` di jaringan yang tidak dipercaya: siapa pun yang bisa mengakses server bisa memakai token login kamu.

## Catatan

- Request PATCH/DELETE mengubah list MAL asli kamu; playground akan minta konfirmasi dulu.
- Parameter `fields` menentukan data yang dikembalikan. Tanpa `fields`, MAL hanya mengirim `id`, `title`, `main_picture`.
- Query/body yang tidak dicentang tidak dikirim.
- Kalau App Redirect URL di MAL beda dengan redirect URI server, playground menolak login sebelum membuka MAL dan menampilkan URL yang harus diisi.
- Kalau belum login di myanimelist.net di browser itu, popup akan minta login MAL dulu, baru halaman Allow.
