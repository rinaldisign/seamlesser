// Utamakan cache. Naikkan versi CACHE setiap kali file diperbarui.
const CACHE='sts-v7',FILES=['./','index.html','styles/app.css','src/app.js','vendor/three.module.js','vendor/three.core.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/favicon-32.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method==='GET')e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
