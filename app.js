
// --- Map init
const map = L.map('map', { zoomControl: false }).setView([46.6, 2.5], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
L.control.zoom({ position:'bottomright' }).addTo(map);
let markers = [], routeLine = null, straightLine = null;

// --- UI refs
const form = document.getElementById('quote-form');
const addStepBtn = document.getElementById('addStep');
const stepsDiv = document.getElementById('steps');
const goBtn = document.getElementById('goBtn');
const resetBtn = document.getElementById('resetBtn');
const result = document.getElementById('result');
const offersDiv = document.getElementById('offers');
const chosenDiv = document.getElementById('chosen');
const trajet = document.getElementById('trajet');
const routeMeta = document.getElementById('routeMeta');
const volMeta = document.getElementById('volMeta');
const summary = document.getElementById('summary');
const toastEl = document.getElementById('toast');
const nav = document.getElementById('navActions');
const navNote = document.getElementById('navNote');
const navWaze = document.getElementById('navWaze');
const navG = document.getElementById('navGmaps');
const navA = document.getElementById('navApple');
const fuelInfo = document.getElementById('fuelInfo');

// --- Helpers
const r2 = x=>Math.round(x*100)/100;
function toRad(d){return d*Math.PI/180}
function haversine(a,b,c,d){const R=6371,dl=toRad(c-a),dn=toRad(d-b);const x=Math.sin(dl/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dn/2)**2;return R*(2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)));}
function showToast(msg, type='info'){ toastEl.textContent=msg; toastEl.style.display='block'; toastEl.style.borderColor = type==='error'?'#5a1f28':'#173051'; setTimeout(()=>toastEl.style.display='none', 2800); }
function volFromDims(L,W,H){ if(!L||!W||!H) return 0; if(L<=0||W<=0||H<=0) return 0; return (L*W*H)/1_000_000; }
function gasoilKmFrom(dieselPrice, consoL100){ if(!dieselPrice||!consoL100) return 0; return (consoL100/100)*dieselPrice; }

// --- Steps UI
function createStepField(value=''){
  const wrap = document.createElement('div');
  wrap.className = 'step';
  wrap.innerHTML = `
    <input type="text" class="step-input" placeholder="Ex: Voiron" value="${value}"/>
    <button type="button" class="remove secondary">❌</button>
  `;
  wrap.querySelector('.remove').addEventListener('click', ()=> wrap.remove());
  return wrap;
}
addStepBtn.addEventListener('click', ()=>{
  stepsDiv.appendChild(createStepField(''));
});

// --- Fuel mode
function loadFuelAvg(){
  return fetch('./assets/fuel/fr-average.json').then(r=>r.json()).catch(()=>({price_eur_per_liter:1.85, updated_at:'N/A'}));
}
function savePrefs(){
  const mode = document.querySelector('input[name="fuelMode"]:checked').value;
  const diesel = document.getElementById('dieselPrice').value;
  const cT = document.getElementById('consoTrafic').value;
  const c14 = document.getElementById('conso14').value;
  localStorage.setItem('ame_prefs', JSON.stringify({mode,diesel,cT,c14}));
}
function loadPrefs(){
  try{
    const p = JSON.parse(localStorage.getItem('ame_prefs')||'{}');
    if(p.mode){ document.querySelectorAll('input[name="fuelMode"]').forEach(r=> r.checked = (r.value===p.mode)); }
    if(p.diesel) document.getElementById('dieselPrice').value = p.diesel;
    if(p.cT) document.getElementById('consoTrafic').value = p.cT;
    if(p.c14) document.getElementById('conso14').value = p.c14;
  }catch{}
}

// --- Vehicles & cost model
const VEHICLES=[
  { id:'ev-city', label:'Citadine électrique', clientTarifKm:0.90, maxKg:150,  maxM3:0.5, fuel:'electric', costPerKm:0.20, consoL100:0 },
  { id:'van-trafic', label:'Fourgonnette (Trafic)', clientTarifKm:1.50, maxKg:900,  maxM3:6,   fuel:'diesel',   costPerKm:0.50, consoL100:8.5 },
  { id:'van-14m3', label:'14 m³ rallongé (Master)', clientTarifKm:1.80, maxKg:1200, maxM3:14,  fuel:'diesel',   costPerKm:0.65, consoL100:11.5 },
];
const COSTS={ driverPerHour:25, jobFixed:5, handlingFee:25, avgSpeedKmh:60, targetMargin:0.15, minPrice:25 };
const surchargePoids=(p,prix)=> p>1000?prix*.30:p>500?prix*.20:p>100?prix*.10:0;

function computeOffers(distanceKm, poidsKg, volumeM3, manutention, dieselPrice, consoOverrides){
  const hours = distanceKm / COSTS.avgSpeedKmh;
  return VEHICLES.map(v=>{
    if(poidsKg&&v.maxKg&&poidsKg>v.maxKg) return null;
    if(volumeM3&&v.maxM3&&volumeM3>v.maxM3) return null;
    const conso = v.id==='van-trafic' ? (consoOverrides?.trafic||v.consoL100) : (v.id==='van-14m3' ? (consoOverrides?.m14||v.consoL100) : v.consoL100);
    const gasoilKmEff = v.fuel==='diesel' ? gasoilKmFrom(dieselPrice, conso) : 0;
    const prixDistance = distanceKm * (v.clientTarifKm + gasoilKmEff);
    const supPoids = surchargePoids(poidsKg, prixDistance);
    const manut = manutention ? COSTS.handlingFee : 0;
    const fixed = COSTS.jobFixed;
    const totalClient = prixDistance + supPoids + manut + fixed;
    const variableCost = v.costPerKm * distanceKm;
    const timeCost = COSTS.driverPerHour * hours;
    const fixedCost = fixed + (manutention ? COSTS.handlingFee : 0);
    const breakEven = variableCost + timeCost + fixedCost;
    const suggested = Math.max(COSTS.minPrice, breakEven*(1+COSTS.targetMargin), totalClient);
    return {
      vehicleId:v.id, vehicle:v.label, fuel:v.fuel,
      price:{ distanceKm:r2(distanceKm), tarifKm:v.clientTarifKm, gasoilKm:r2(gasoilKmEff), prixDistance:r2(prixDistance), surchargePoids:r2(supPoids), manutention:manut, fraisFixes:fixed, totalHT:r2(totalClient) },
      cost:{ breakEven:r2(breakEven), suggested:r2(suggested) },
      capacity:{ maxKg:v.maxKg, maxM3:v.maxM3 },
      meta:{ dieselPrice, consoL100:conso }
    };
  }).filter(Boolean).sort((a,b)=>a.cost.suggested-b.cost.suggested);
}

// --- Map drawing
function clearMap(){
  markers.forEach(m=>map.removeLayer(m)); markers=[];
  if(routeLine){ map.removeLayer(routeLine); routeLine=null; }
  if(straightLine){ map.removeLayer(straightLine); straightLine=null; }
}
function addMarker(lat,lon,label){
  const m = L.marker([lat,lon]).addTo(map).bindPopup(label);
  markers.push(m);
}
function drawGeometry(geometry){
  if (!geometry || !geometry.coordinates) return;
  const latlngs = geometry.coordinates.map(([lon,lat])=>[lat,lon]);
  routeLine = L.polyline(latlngs, { weight:5, opacity:.95 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding:[40,40] });
}

// --- Geocode + OSRM
async function geocodeOne(q){
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
  if(!r.ok) throw new Error('Geocode KO');
  const d = await r.json();
  if(!Array.isArray(d)||!d.length) throw new Error('Adresse introuvable');
  const {lat,lon,display_name} = d[0];
  return { lat:parseFloat(lat), lon:parseFloat(lon), label: display_name };
}
async function osrmRoute(coords, avoid){
  const coordStr = coords.map(c=>`${c.lon},${c.lat}`).join(';');
  const params = new URLSearchParams({ overview:'full', geometries:'geojson', steps:'false', alternatives:'false' });
  if(avoid) params.set('exclude', avoid);
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?${params.toString()}`;
  const r = await fetch(url, { headers:{ 'User-Agent':'AME-V9.1' } });
  if(!r.ok) throw new Error('OSRM KO');
  const data = await r.json();
  if(!data || !data.routes || !data.routes.length) throw new Error('Route introuvable');
  const route = data.routes[0];
  return { distanceKm: r2(route.distance/1000), durationMin: Math.round(route.duration/60), geometry: route.geometry };
}

// --- Render
function renderOffers(data){
  offersDiv.innerHTML='';
  data.offers.forEach((o, idx)=>{
    const tag=o.fuel==='electric'?'<span class="tag">Électrique</span>':'<span class="tag">Diesel</span>';
    const html=`
      <div class="offer">
        <h4>${o.vehicle} ${tag}<span class="badge">€/km carbu: ${o.price.gasoilKm.toFixed(2)}</span></h4>
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
      const o=data.offers[Number(btn.dataset.idx)];
      chosenDiv.style.display='block';
      chosenDiv.innerHTML=`
        <h3>Devis retenu — ${o.vehicle}</h3>
        <div class="row"><span>Total HT conseillé</span><span><b>${o.cost.suggested.toFixed(2)} €</b></span></div>
        <div class="row"><span>Distance</span><span>${o.price.distanceKm} km</span></div>
        <div class="row"><span>Tarifs (km)</span><span>${o.price.tarifKm} + ${o.price.gasoilKm}</span></div>
        <div class="row"><span>Supplément poids</span><span>${o.price.surchargePoids.toFixed(2)} €</span></div>
        <div class="row"><span>Manutention</span><span>${(o.price.manutention||0).toFixed(2)} €</span></div>
        <div class="row"><span>Frais fixes</span><span>${o.price.fraisFixes.toFixed(2)} €</span></div>
        <div style="margin-top:8px" class="meta">Seuil de rentabilité: ${o.cost.breakEven.toFixed(2)} € • Marge cible 15%</div>`;
      chosenDiv.scrollIntoView({behavior:'smooth'});
    });
  });
}

// --- Navigation links
function buildNavLinks(geoList){
  if(!geoList || geoList.length<2){ nav.style.display='none'; return; }
  nav.style.display='flex';
  const origin = geoList[0], dest = geoList[geoList.length-1];
  const steps = geoList.slice(1,-1);

  const oLabel = encodeURIComponent(origin.label); const dLabel = encodeURIComponent(dest.label);
  const waypoints = steps.map(s=> `${s.lat},${s.lon}`).join('|');
  const waypointsEnc = encodeURIComponent(waypoints);

  // Google Maps (multi-étapes ok)
  let gmaps = `https://www.google.com/maps/dir/?api=1&origin=${oLabel}&destination=${dLabel}&travelmode=driving`;
  if(steps.length) gmaps += `&waypoints=${waypointsEnc}`;
  navG.href = gmaps;

  // Apple Maps (multi-étapes via daddr=via:)
  let apple = `https://maps.apple.com/?saddr=${oLabel}`;
  steps.forEach(s=> apple += `&daddr=via:${encodeURIComponent(s.label)}`);
  apple += `&daddr=${dLabel}&dirflg=d`;
  navA.href = apple;

  // Waze (multi-étapes pas supporté en un lien) → destination finale
  navWaze.href = `https://waze.com/ul?ll=${dest.lat},${dest.lon}&from=${origin.lat},${origin.lon}&navigate=yes`;
  navNote.style.display = steps.length ? 'block' : 'none';
}

// --- Submit
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  result.style.display='none'; offersDiv.innerHTML=''; chosenDiv.style.display='none'; chosenDiv.innerHTML=''; volMeta.textContent=''; summary.textContent=''; nav.style.display='none'; navNote.style.display='none';
  clearMap();

  const origin = document.getElementById('origin').value.trim();
  const destination = document.getElementById('destination').value.trim();
  const poids = parseFloat(document.getElementById('poids').value||'0');
  const volume = parseFloat(document.getElementById('volume').value||'0');
  const len = parseFloat(document.getElementById('len').value||'0');
  const wid = parseFloat(document.getElementById('wid').value||'0');
  const hei = parseFloat(document.getElementById('hei').value||'0');
  const manut = document.getElementById('manutention').value==='true';
  const avoid = document.getElementById('avoid').value;

  // Fuel
  const mode = document.querySelector('input[name="fuelMode"]:checked').value;
  let dieselPrice = parseFloat(document.getElementById('dieselPrice').value||'0');
  const consoTrafic = parseFloat(document.getElementById('consoTrafic').value||'8.5');
  const conso14 = parseFloat(document.getElementById('conso14').value||'11.5');
  savePrefs();

  if(!origin||!destination||!poids||poids<=0){ showToast('Saisis une origine, une destination et un poids valide.', 'error'); return; }
  const volDims = volFromDims(len,wid,hei);
  const volUsed = volDims>0?volDims:(volume>0?volume:0);
  if(volUsed>0) volMeta.textContent=`Volume pris en compte: ${volUsed.toFixed(3)} m³`;

  goBtn.disabled=true; goBtn.textContent='Calcul en cours…';

  try {
    // Fuel auto load if needed
    if(mode==='auto'){
      try{
        const f = await fetch('./assets/fuel/fr-average.json').then(r=>r.json());
        dieselPrice = parseFloat(f.price_eur_per_liter || dieselPrice || 1.85);
        fuelInfo.textContent = `Auto: ${dieselPrice.toFixed(2)} €/L • Maj ${f.updated_at||'N/A'}`;
        document.getElementById('dieselPrice').value = dieselPrice.toFixed(2);
      }catch{ /* ignore */ }
    }else{
      fuelInfo.textContent = `Manuel: ${dieselPrice.toFixed(2)} €/L`;
    }

    // Geocode all
    const stepInputs = Array.from(document.querySelectorAll('.step-input')).map(i=>i.value.trim()).filter(Boolean);
    const allAddresses = [origin, ...stepInputs, destination];
    const geos = await Promise.all(allAddresses.map(async q=>{
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
      if(!r.ok) throw new Error('Geocode KO');
      const d = await r.json();
      if(!Array.isArray(d)||!d.length) throw new Error('Adresse introuvable');
      const {lat,lon,display_name} = d[0];
      return { lat:parseFloat(lat), lon:parseFloat(lon), label: display_name };
    }));

    // Draw markers
    addMarker(geos[0].lat, geos[0].lon, 'Départ (A)');
    for(let i=1;i<geos.length-1;i++){ addMarker(geos[i].lat, geos[i].lon, `Étape ${i}`); }
    addMarker(geos[geos.length-1].lat, geos[geos.length-1].lon, 'Arrivée (B)');

    // Route OSRM
    const coordStr = geos.map(c=>`${c.lon},${c.lat}`).join(';');
    const params = new URLSearchParams({ overview:'full', geometries:'geojson', steps:'false', alternatives:'false' });
    if(avoid) params.set('exclude', avoid);
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?${params.toString()}`;
    const rr = await fetch(url, { headers:{ 'User-Agent':'AME-V9.1' } });
    if(!rr.ok) throw new Error('OSRM KO');
    const data = await rr.json();
    if(!data || !data.routes || !data.routes.length) throw new Error('Route introuvable');
    const route = data.routes[0];
    const distanceKm = r2(route.distance/1000); const durationMin = Math.round(route.duration/60);
    // Draw
    const geometry = route.geometry;
    if (geometry && geometry.coordinates){
      const latlngs = geometry.coordinates.map(([lon,lat])=>[lat,lon]);
      routeLine = L.polyline(latlngs, { weight:5, opacity:.95 }).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding:[40,40] });
    }
    // Summary
    summary.textContent = `Distance: ${distanceKm} km • Durée: ${durationMin} min`;
    trajet.textContent = `${geos[0].label.split(',')[0]} → ${geos.slice(1,-1).map(g=>g.label.split(',')[0]).join(' → ')}${geos.length>2?' → ':''}${geos[geos.length-1].label.split(',')[0]}`;
    routeMeta.textContent = `Étapes: ${geos.length-2 >= 0 ? geos.length-2 : 0}`;
    result.style.display='block';

    // Offers
    const offers = computeOffers(distanceKm, poids, volUsed, manut, dieselPrice, { trafic: consoTrafic, m14: conso14 });
    renderOffers({offers});

    // Nav links
    // Google Maps multi-stop
    const oLabel = encodeURIComponent(geos[0].label); const dLabel = encodeURIComponent(geos[geos.length-1].label);
    const wps = geos.slice(1,-1).map(s=> `${s.lat},${s.lon}`).join('|');
    const wpsEnc = encodeURIComponent(wps);
    let gmaps = `https://www.google.com/maps/dir/?api=1&origin=${oLabel}&destination=${dLabel}&travelmode=driving`;
    if(geos.length>2) gmaps += `&waypoints=${wpsEnc}`;
    navG.href = gmaps;
    // Apple
    let apple = `https://maps.apple.com/?saddr=${oLabel}`;
    geos.slice(1,-1).forEach(s=> apple += `&daddr=via:${encodeURIComponent(s.label)}`);
    apple += `&daddr=${dLabel}&dirflg=d`;
    navA.href = apple;
    // Waze (final only)
    navWaze.href = `https://waze.com/ul?ll=${geos[geos.length-1].lat},${geos[geos.length-1].lon}&from=${geos[0].lat},${geos[0].lon}&navigate=yes`;
    nav.style.display='flex';
    navNote.style.display = geos.length>2 ? 'block' : 'none';

  } catch(err){
    console.error(err);
    showToast('Impossible de calculer la route (OSRM). Passage en mode approximatif.', 'error');
    try{
      const stepInputs = Array.from(document.querySelectorAll('.step-input')).map(i=>i.value.trim()).filter(Boolean);
      const all = [document.getElementById('origin').value.trim(), ...stepInputs, document.getElementById('destination').value.trim()];
      const geos = await Promise.all(all.map(async q=>{
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
        if(!r.ok) throw new Error('Geocode KO');
        const d = await r.json();
        if(!Array.isArray(d)||!d.length) throw new Error('Adresse introuvable');
        const {lat,lon,display_name} = d[0];
        return { lat:parseFloat(lat), lon:parseFloat(lon), label: display_name };
      }));
      addMarker(geos[0].lat, geos[0].lon, 'Départ (A)');
      for(let i=1;i<geos.length-1;i++){ addMarker(geos[i].lat, geos[i].lon, `Étape ${i}`); }
      addMarker(geos[geos.length-1].lat, geos[geos.length-1].lon, 'Arrivée (B)');
      let dist=0; for(let i=0;i<geos.length-1;i++){ dist += haversine(geos[i].lat, geos[i].lon, geos[i+1].lat, geos[i+1].lon); }
      straightLine = L.polyline(geos.map(g=>[g.lat,g.lon]), {weight:4,opacity:.8}).addTo(map);
      map.fitBounds(straightLine.getBounds(), { padding:[40,40] });
      summary.textContent=`Distance (approx): ${r2(dist)} km`;
      trajet.textContent = `${geos[0].label.split(',')[0]} → ${geos.slice(1,-1).map(g=>g.label.split(',')[0]).join(' → ')}${geos.length>2?' → ':''}${geos[geos.length-1].label.split(',')[0]}`;
      routeMeta.textContent=`Étapes: ${geos.length-2 >= 0 ? geos.length-2 : 0} • Mode local`;
      result.style.display='block';
      const diesel = parseFloat(document.getElementById('dieselPrice').value||'1.85');
      const consoTrafic = parseFloat(document.getElementById('consoTrafic').value||'8.5');
      const conso14 = parseFloat(document.getElementById('conso14').value||'11.5');
      const offers = computeOffers(r2(dist), parseFloat(document.getElementById('poids').value||'0'), parseFloat(document.getElementById('volume').value||'0'), document.getElementById('manutention').value==='true', diesel, { trafic: consoTrafic, m14: conso14 });
      renderOffers({offers});
      // Nav
      const oLabel = encodeURIComponent(geos[0].label); const dLabel = encodeURIComponent(geos[geos.length-1].label);
      const wps = geos.slice(1,-1).map(s=> `${s.lat},${s.lon}`).join('|');
      const wpsEnc = encodeURIComponent(wps);
      let gmaps = `https://www.google.com/maps/dir/?api=1&origin=${oLabel}&destination=${dLabel}&travelmode=driving`;
      if(geos.length>2) gmaps += `&waypoints=${wpsEnc}`;
      navG.href = gmaps;
      let apple = `https://maps.apple.com/?saddr=${oLabel}`;
      geos.slice(1,-1).forEach(s=> apple += `&daddr=via:${encodeURIComponent(s.label)}`);
      apple += `&daddr=${dLabel}&dirflg=d`;
      navA.href = apple;
      navWaze.href = `https://waze.com/ul?ll=${geos[geos.length-1].lat},${geos[geos.length-1].lon}&from=${geos[0].lat},${geos[0].lon}&navigate=yes`;
      nav.style.display='flex';
      navNote.style.display = geos.length>2 ? 'block' : 'none';
    }catch(e2){
      showToast('Échec total du calcul. Réessaye.', 'error');
    }
  } finally {
    goBtn.disabled=false; goBtn.textContent='🚀 Obtenir les offres';
  }
});

resetBtn.addEventListener('click',()=>{
  document.getElementById('origin').value='';
  document.getElementById('destination').value='';
  document.getElementById('poids').value='';
  document.getElementById('volume').value='0';
  document.getElementById('len').value='0';
  document.getElementById('wid').value='0';
  document.getElementById('hei').value='0';
  stepsDiv.innerHTML='';
  result.style.display='none'; offersDiv.innerHTML=''; chosenDiv.style.display='none'; chosenDiv.innerHTML=''; volMeta.textContent=''; summary.textContent=''; nav.style.display='none'; navNote.style.display='none';
  markers.forEach(m=>map.removeLayer(m)); markers=[];
  if(routeLine){ map.removeLayer(routeLine); routeLine=null; }
  if(straightLine){ map.removeLayer(straightLine); straightLine=null; }
});

// Init
(function init(){
  try{
    const p = JSON.parse(localStorage.getItem('ame_prefs')||'{}');
    if(p.mode){ document.querySelectorAll('input[name="fuelMode"]').forEach(r=> r.checked = (r.value===p.mode)); }
    if(p.diesel) document.getElementById('dieselPrice').value = p.diesel;
    if(p.cT) document.getElementById('consoTrafic').value = p.cT;
    if(p.c14) document.getElementById('conso14').value = p.c14;
  }catch{}
  // Load auto fuel info display
  fetch('./assets/fuel/fr-average.json').then(r=>r.json()).then(f=>{
    if(document.querySelector('input[name="fuelMode"]:checked').value==='auto'){
      document.getElementById('dieselPrice').value = parseFloat(f.price_eur_per_liter||1.85).toFixed(2);
      fuelInfo.textContent = `Auto: ${parseFloat(f.price_eur_per_liter||1.85).toFixed(2)} €/L • Maj ${f.updated_at||'N/A'}`;
    }
  }).catch(()=>{});
})();
