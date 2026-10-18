# Seamless Texture Studio
Web lokal (tanpa server/AI) untuk membuat tekstur seamless. Gambar tidak pernah diunggah.

## Deploy ke GitHub Pages
1. Upload seluruh isi folder ini ke repo GitHub (branch `main`).
2. Settings → Pages → Source: **GitHub Actions**. Setiap push ke `main` otomatis ter-deploy.
3. Buka `https://<user>.github.io/<repo>/`.

## Jalankan lokal
`npx serve` (atau `python -m http.server`) lalu buka alamatnya. Tidak bisa lewat `file://`.

## Pin ke taskbar
Buka di Chrome/Edge → tombol 「インストール」 (atau menu ⋮ → Install app) → klik kanan ikon di taskbar → Pin.
Setelah mengubah file, naikkan versi `CACHE` di `sw.js`.
