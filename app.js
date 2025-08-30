
const OSRM = "https://router.project-osrm.org";
const LAYER = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

// Map
const map = L.map('map', { zoomControl:false }).setView([46.6,2.5],6);
L.tileLayer(LAYER,{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
L.control.zoom({position:'bottomright'}).addTo(map);
let markers=[], routeLine=null, polyline=null;
function clearMap(){ markers.forEach(m=>map.removeLayer(m)); markers=[]; if(routeLine){map.removeLayer(routeLine); routeLine=null;} if(polyline){map.removeLayer(polyline); polyline=null;} }
function addMarkers(a,b){ const m1=L.marker([a.lat,a.lon]).addTo(map).bindPopup('Départ'); const m2=L.marker([b.lat,b.lon]).addTo(map).bindPopup('Arrivée'); markers=[m1,m2]; }

function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.style.display='block'; setTimeout(()=>t.style.display='none',2200); }
const r2 = x=>Math.round(x*100)/100; const toRad=x=>x*Math.PI/180; const hav=(a,b,c,d)=>{const R=6371,dl=toRad(c-a),dn=toRad(d-b);const x=Math.sin(dl/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dn/2)**2;return R*(2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)));}

// Caches
const geoCache = new Map(); // key=query -> {lat,lon,label}
const routeCache = new Map(); // key=origin|dest|avoid -> {distanceKm,durationMin,geometry}

async function geocodeOne(q){
  if(geoCache.has(q)) return geoCache.get(q);
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
  if(!r.ok) throw new Error('Geocode fail');
  const d = await r.json(); if(!Array.isArray(d)||!d.length) throw new Error('Adresse introuvable: '+q);
  const v = { lat:parseFloat(d[0].lat), lon:parseFloat(d[0].lon), label:d[0].display_name };
  geoCache.set(q, v); return v;
}

// Debounced autocomplete (reduces API calls)
function debounce(fn, ms){ let t; return (...args)=>{clearTimeout(t); t=setTimeout(()=>fn(...args),ms);}}
async function suggest(q, dlId){
  if(!q || q.trim().length<3) return;
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`);
  if(!r.ok) return;
  const d = await r.json();
  const dl = document.getElementById(dlId);
  dl.innerHTML = d.map(x=>`<option value="${x.display_name.replace(/"/g,'&quot;')}">`).join('');
}
const suggestDeb = debounce(suggest, 250);
document.getElementById('origin').addEventListener('input', e=>suggestDeb(e.target.value,'dl-origin'));
document.getElementById('destination').addEventListener('input', e=>suggestDeb(e.target.value,'dl-dest'));

// OSRM route with caching + abort previous
let routeAbort=null;
async function osrmRoute(a,b,avoid=""){
  const key = `${a.lat},${a.lon}|${b.lat},${b.lon}|${avoid}`;
  if(routeCache.has(key)) return routeCache.get(key);
  if(routeAbort) routeAbort.abort();
  routeAbort = new AbortController();
  const coords = `${a.lon},${a.lat};${b.lon},${b.lat}`;
  const params = new URLSearchParams({overview:'full',geometries:'geojson',steps:'false',alternatives:'false'});
  if(avoid) params.set('exclude', avoid);
  const url = `${OSRM}/route/v1/driving/${coords}?${params.toString()}`;
  const r = await fetch(url,{signal: routeAbort.signal});
  if(!r.ok) throw new Error('OSRM route down');
  const d = await r.json();
  if(!d.routes || !d.routes.length) throw new Error('Route introuvable');
  const route = d.routes[0];
  const latlngs = route.geometry.coordinates.map(([x,y])=>[y,x]);
  if(routeLine) map.removeLayer(routeLine);
  routeLine = L.polyline(latlngs,{weight:5,opacity:.95}).addTo(map);
  map.fitBounds(routeLine.getBounds(), {padding:[40,40]});
  const val = { distanceKm: r2(route.distance/1000), durationMin: Math.round(route.duration/60), geometry: route.geometry };
  routeCache.set(key, val);
  return val;
}

// Pricing
const VEHICLES=[
  { id:'ev-city',   label:'Citadine électrique', clientTarifKm:0.90, maxKg:150,  maxM3:0.5, fuel:'electric', costPerKm:0.20, consoL100:0 },
  { id:'van-trafic',label:'Fourgonnette (Trafic)', clientTarifKm:1.50, maxKg:900,  maxM3:6,   fuel:'diesel',   costPerKm:0.50, consoL100:8.5 },
  { id:'van-14m3',  label:'14 m³ rallongé (Master)', clientTarifKm:1.80, maxKg:1200, maxM3:14,  fuel:'diesel',   costPerKm:0.65, consoL100:11.5 },
];
const COSTS={ driverPerHour:25, jobFixed:5, handlingFee:25, avgSpeedKmh:60, targetMargin:0.15, minPrice:25 };
const surchargePoids=(p,prix)=> p>1000?prix*.30:p>500?prix*.20:p>100?prix*.10:0;
const gasoilKmFrom=(price,conso)=> (!price||!conso)?0:(conso/100)*price;
const volFromDims=(L,W,H)=> (L>0&&W>0&&H>0)? (L*W*H)/1_000_000 : 0;
function computeOffers(distanceKm, poidsKg, volumeM3, manutention, dieselPrice, consos){
  const hours=distanceKm/COSTS.avgSpeedKmh;
  return VEHICLES.map(v=>{
    if(poidsKg && v.maxKg && poidsKg>v.maxKg) return null;
    if(volumeM3 && v.maxM3 && volumeM3>v.maxM3) return null;
    const conso = v.id==='van-trafic'? (consos?.trafic||v.consoL100) : v.id==='van-14m3'? (consos?.m14||v.consoL100) : v.consoL100;
    const gasoilKm = v.fuel==='diesel'? gasoilKmFrom(dieselPrice, conso) : 0;
    const prixDistance = distanceKm * (v.clientTarifKm + gasoilKm);
    const supPoids = surchargePoids(poidsKg, prixDistance);
    const manut = manutention ? COSTS.handlingFee : 0;
    const fixed = COSTS.jobFixed;
    const totalClient = prixDistance + supPoids + manut + fixed;
    const variableCost=v.costPerKm*distanceKm, timeCost=COSTS.driverPerHour*hours, fixedCost=fixed + (manutention?COSTS.handlingFee:0);
    const breakEven = variableCost + timeCost + fixedCost;
    const suggested = Math.max(COSTS.minPrice, breakEven*(1+COSTS.targetMargin), totalClient);
    return { vehicle:v.label, fuel:v.fuel, price:{distanceKm:r2(distanceKm),tarifKm:v.clientTarifKm,gasoilKm:r2(gasoilKm),prixDistance:r2(prixDistance),surchargePoids:r2(supPoids),manutention:manut,fraisFixes:fixed,totalHT:r2(totalClient)}, cost:{breakEven:r2(breakEven), suggested:r2(suggested)} };
  }).filter(Boolean).sort((a,b)=>a.cost.suggested-b.cost.suggested);
}

// UI refs
const form=document.getElementById('quote-form'); const goBtn=document.getElementById('goBtn'); const goLabel=document.getElementById('goLabel');
const result=document.getElementById('result'); const offersDiv=document.getElementById('offers'); const chosenDiv=document.getElementById('chosen');
const trajet=document.getElementById('trajet'); const routeMeta=document.getElementById('routeMeta'); const volMeta=document.getElementById('volMeta'); const summary=document.getElementById('summary');
const nav=document.getElementById('navActions'); const navG=document.getElementById('navGmaps'); const navA=document.getElementById('navApple'); const navW=document.getElementById('navWaze');

function renderSkeleton(){ offersDiv.innerHTML=`
  <div class="card"><div class="skel" style="height:18px;width:60%"></div><div class="skel" style="height:12px;margin-top:8px"></div><div class="skel" style="height:12px;margin-top:8px;width:80%"></div></div>
  <div class="card"><div class="skel" style="height:18px;width:50%"></div><div class="skel" style="height:12px;margin-top:8px"></div><div class="skel" style="height:12px;margin-top:8px;width:70%"></div></div>`; }

function renderOffers(offers){
  offersDiv.innerHTML='';
  offers.forEach((o, idx)=>{
    const tag=o.fuel==='electric'?'<span class="tag">Électrique</span>':'<span class="tag">Diesel</span>';
    const html=`
      <div class="card">
        <h4>${o.vehicle} ${tag}</h4>
        <div class="row"><span>Prix distance</span><span>${o.price.distanceKm} km × (${o.price.tarifKm} + ${o.price.gasoilKm}) → ${o.price.prixDistance.toFixed(2)} €</span></div>
        <div class="row"><span>Supplément poids</span><span>${o.price.surchargePoids.toFixed(2)} €</span></div>
        <div class="row"><span>Manutention</span><span>${(o.price.manutention||0).toFixed(2)} €</span></div>
        <div class="row"><span>Frais fixes</span><span>${o.price.fraisFixes.toFixed(2)} €</span></div>
        <div class="row"><span>Seuil rentabilité</span><span>${o.cost.breakEven.toFixed(2)} €</span></div>
        <div class="row"><span class="price">Prix conseillé</span><span class="price">${o.cost.suggested.toFixed(2)} € HT</span></div>
        <div class="choose"><button class="primary" data-idx="${idx}">Choisir cette offre</button></div>
      </div>`;
    const w=document.createElement('div'); w.innerHTML=html; offersDiv.appendChild(w.firstElementChild);
  });
  offersDiv.querySelectorAll('button[data-idx]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const o = offers[Number(btn.dataset.idx)];
      chosenDiv.style.display='block';
      chosenDiv.innerHTML=`
        <h3>Devis retenu</h3>
        <div class="row"><span>Total HT conseillé</span><span><b>${o.cost.suggested.toFixed(2)} €</b></span></div>
        <div class="row"><span>Distance</span><span>${o.price.distanceKm} km</span></div>
        <div class="row"><span>Tarifs (km)</span><span>${o.price.tarifKm} + ${o.price.gasoilKm}</span></div>
        <div class="row"><span>Supplément poids</span><span>${o.price.surchargePoids.toFixed(2)} €</span></div>
        <div class="row"><span>Manutention</span><span>${(o.price.manutention||0).toFixed(2)} €</span></div>
        <div class="row"><span>Frais fixes</span><span>${o.price.fraisFixes.toFixed(2)} €</span></div>`;
      chosenDiv.scrollIntoView({behavior:'smooth'});
    });
  });
}

function buildNavLinks(o,d){
  nav.style.display='flex';
  const enc=s=>encodeURIComponent(s);
  const oL = o.label || `${o.lat},${o.lon}`, dL = d.label || `${d.lat},${d.lon}`;
  navG.href = `https://www.google.com/maps/dir/?api=1&origin=${enc(oL)}&destination=${enc(dL)}&travelmode=driving`;
  navA.href = `https://maps.apple.com/?saddr=${enc(oL)}&daddr=${enc(dL)}&dirflg=d`;
  navW.href = `https://waze.com/ul?ll=${d.lat},${d.lon}&navigate=yes`;
}

// Reset
document.getElementById('resetBtn').addEventListener('click', ()=>{
  clearMap(); result.style.display='none'; offersDiv.innerHTML=''; chosenDiv.style.display='none'; chosenDiv.innerHTML=''; volMeta.textContent=''; summary.textContent=''; nav.style.display='none';
});

// Submit
document.getElementById('quote-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  result.style.display='none'; offersDiv.innerHTML=''; chosenDiv.style.display='none'; chosenDiv.innerHTML=''; volMeta.textContent=''; nav.style.display='none';
  const originQ=document.getElementById('origin').value.trim();
  const destinationQ=document.getElementById('destination').value.trim();
  const poids=parseFloat(document.getElementById('poids').value||'0');
  const volume=parseFloat(document.getElementById('volume').value||'0');
  const len=parseFloat(document.getElementById('len').value||'0');
  const wid=parseFloat(document.getElementById('wid').value||'0');
  const hei=parseFloat(document.getElementById('hei').value||'0');
  const manut=document.getElementById('manutention').value==='true';
  const avoid=document.getElementById('avoid').value;
  const dieselPrice=parseFloat(document.getElementById('dieselPrice').value||'0');
  const consoTrafic=parseFloat(document.getElementById('consoTrafic').value||'8.5');
  const conso14=parseFloat(document.getElementById('conso14').value||'11.5');
  if(!originQ||!destinationQ||!poids||poids<=0){ showToast('Remplis Départ, Arrivée et Poids.'); return; }
  const volDims=volFromDims(len,wid,hei);
  const volUsed=volDims>0?volDims:(volume>0?volume:0);
  if(volUsed>0) volMeta.textContent=`Volume pris en compte: ${volUsed.toFixed(3)} m³`;

  goBtn.disabled=true; goLabel.textContent='Calcul...'; renderSkeleton();
  try{
    const [o,d] = await Promise.all([geocodeOne(originQ), geocodeOne(destinationQ)]);
    clearMap(); addMarkers(o,d);
    const info = await osrmRoute(o,d,avoid);
    document.getElementById('summary').textContent = `Distance: ${info.distanceKm} km • Durée: ${info.durationMin} min`;
    document.getElementById('trajet').textContent = `${o.label.split(',')[0]} → ${d.label.split(',')[0]}`;
    routeMeta.textContent='';
    const offers = computeOffers(info.distanceKm, poids, volUsed, manut, dieselPrice, {trafic:consoTrafic, m14:conso14});
    result.style.display='block'; renderOffers(offers); buildNavLinks(o,d);
  }catch(err){
    console.error(err);
    try{
      const [o,d] = await Promise.all([geocodeOne(originQ), geocodeOne(destinationQ)]);
      clearMap(); addMarkers(o,d);
      const dist = r2(hav(o.lat,o.lon,d.lat,d.lon));
      polyline = L.polyline([[o.lat,o.lon],[d.lat,d.lon]], {weight:4,opacity:.85}).addTo(map);
      map.fitBounds(polyline.getBounds(), {padding:[40,40]});
      summary.textContent = `Distance (approx): ${dist} km`;
      trajet.textContent = `${o.label.split(',')[0]} → ${d.label.split(',')[0]}`; routeMeta.textContent='Mode local (API indispo)';
      const offers = computeOffers(dist, poids, volUsed, manut, dieselPrice, {trafic:consoTrafic, m14:conso14});
      result.style.display='block'; renderOffers(offers); buildNavLinks(o,d);
    }catch(e2){ showToast('Impossible de calculer le devis.'); }
  }finally{ goBtn.disabled=false; goLabel.textContent='Obtenir les offres'; }
});
