
const CACHE = 'ame-pwa-v4'; // force update
const SHELL = ['./','./index.html','./optimize.html','./styles.css','./app.js','./optimize.js','./assets/ame-logo.svg','./assets/icon-192.png','./assets/icon-512.png','./manifest.webmanifest','https://unpkg.com/leaflet@1.9.4/dist/leaflet.css','https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{
  const req=e.request, url=new URL(req.url), isCDN=url.hostname.includes('unpkg.com');
  if(req.method!=='GET') return;
  if(url.origin!==self.location.origin && !isCDN) return;
  if(req.destination==='document'){
    e.respondWith(fetch(req).then(res=>{caches.open(CACHE).then(c=>c.put(req,res.clone()));return res;}).catch(()=>caches.match(req)));
  } else {
    e.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{caches.open(CACHE).then(c=>c.put(req,res.clone()));return res;})));
  }
});
