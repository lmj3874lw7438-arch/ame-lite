
// AME V9 Premium Lite — Frontend-only (OSRM routing + fuel + navigation)
const map = L.map('map', { zoomControl: false }).setView([46.6, 2.5], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
L.control.zoom({ position:'bottomright' }).addTo(map);

let markers=[], straightLine=null, routeLine=null;
function updateMarkers(a,b){
  markers.forEach(m=>map.removeLayer(m));
  if (straightLine){ map.removeLayer(straightLine); straightLine=null; }
  if (routeLine){ map.removeLayer(routeLine); routeLine=null; }
  const m1=L.marker([a.lat,a.lon]).addTo(map).bindPopup('Départ'); const m2=L.marker([b.lat,b.lon]).addTo(map).bindPopup('Arrivée');
  markers=[m1,m2];
}
function drawRoute(geojson){
  if (!geojson || !geojson.coordinates) return;
  if (routeLine){ map.removeLayer(routeLine); routeLine=null; }
  const latlngs = geojson.coordinates.map(([lon,lat])=>[lat,lon]);
  routeLine = L.polyline(latlngs, { weight:5, opacity:.95 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding:[40,40] });
}

const form = document.getElementById('quote-form');
const goBtn = document.getElementById('goBtn');
const resetBtn = document.getElementById('resetBtn');
const result = document.getElementById('result');
const offersDiv = document.getElementById('offers');
const chosenDiv = document.getElementById('chosen');
const trajet = document.getElementById('trajet');
const routeMeta = document.getElementById('routeMeta');
const volMeta = document.getElementById('volMeta');
const summary = document.getElementById('summary');
const toast = document.getElementById('toast');
const nav = document.getElementById('navActions');
const aW = document.getElementById('navWaze');
const aG = document.getElementById('navGmaps');
const aA = document.getElementById('navApple');
const fuelAuto = document.getElementById('fuelAuto');
const fuelManual = document.getElementById('fuelManual');
const dieselPriceEl = document.getElementById('dieselPrice');
const fuelMeta = document.getElementById('fuelMeta');
const refreshFuelBtn = document.getElementById('refreshFuel');

function showToast(msg){ toast.textContent=msg; toast.classList.remove('hidden'); setTimeout(()=>toast.classList.add('hidden'), 2500); }

// Geocode via Nominatim
async function geocode(q){
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers:{ 'Accept':'application/json' } });
  if (!r.ok) throw new Error('Geocode');
  const d = await r.json();
  if (!Array.isArray(d) || d.length===0) throw new Error('Aucune adresse');
  const { lat, lon, display_name } = d[0];
  return { lat: parseFloat(lat), lon: parseFloat(lon), label: display_name };
}

// OSRM route
async function osrmRoute(a, b, avoid=''){
  const base = 'https://router.project-osrm.org';
  const profile = 'driving';
  const coords = `${a.lon},${a.lat};${b.lon},${b.lat}`;
  const params = new URLSearchParams({ overview:'full', geometries:'geojson', steps:'false', alternatives:'false' });
  if (avoid) params.set('exclude', avoid);
  const url = `${base}/route/v1/${profile}/${coords}?${params.toString()}`;
  const r = await fetch(url, { headers:{ 'Accept':'application/json' } });
  if (!r.ok) throw new Error('Route');
  const data = await r.json();
  if (!data || !Array.isArray(data.routes) || !data.routes.length) throw new Error('Route introuvable');
  const route = data.routes[0];
  return { distanceKm: Math.round(route.distance/10)/100, durationMin: Math.round(route.duration/60), geometry: route.geometry };
}

// Helpers
const r2 = x=>Math.round(x*100)/100;
function gasoilKmFrom(dieselPrice, consoL100){ return (consoL100>0 && dieselPrice>0) ? (consoL100/100)*dieselPrice : 0; }
const VEHICLES=[
  { id:'ev-city', label:'Citadine électrique', clientTarifKm:0.90, maxKg:150,  maxM3:0.5, fuel:'electric', costPerKm:0.20, consoL100:0 },
  { id:'van-trafic', label:'Fourgonnette (Trafic)', clientTarifKm:1.50, maxKg:900,  maxM3:6,   fuel:'diesel',   costPerKm:0.50, consoL100:8.5 },
  { id:'van-14m3', label:'14 m³ rallongé (Master)', clientTarifKm:1.80, maxKg:1200, maxM3:14,  fuel:'diesel',   costPerKm:0.65, consoL100:11.5 },
];
const COSTS={ driverPerHour:25, jobFixed:5, handlingFee:25, avgSpeedKmh:60, targetMargin:0.15, minPrice:25 };
function surchargePoids(p, prix){ if(p>1000) return prix*.30; if(p>500) return prix*.20; if(p>100) return prix*.10; return 0; }

function computeOffers(distanceKm, poidsKg, volumeM3, manutention, dieselPrice, consoOverrides){
  const hours = distanceKm / COSTS.avgSpeedKmh;
  return VEHICLES.map(v=>{
    if (poidsKg && v.maxKg && poidsKg>v.maxKg) return null;
    if (volumeM3 && v.maxM3 && volumeM3>v.maxM3) return null;

    const consoL100 = v.id==='van-trafic' ? (consoOverrides?.trafic||v.consoL100) :
                        v.id==='van-14m3' ? (consoOverrides?.m14||v.consoL100) : v.consoL100;
    const gasoilKm = v.fuel==='diesel' ? gasoilKmFrom(dieselPrice, consoL100) : 0;
    const prixDistance = distanceKm * (v.clientTarifKm + gasoilKm);
    const supPoids = surchargePoids(poidsKg, prixDistance);
    const manut = manutention ? COSTS.handlingFee : 0;
    const fixed = COSTS.jobFixed;
    const totalClient = prixDistance + supPoids + manut + fixed;

    const variableCost = v.costPerKm * distanceKm;
    const timeCost = COSTS.driverPerHour * hours;
    const fixedCost = fixed + (manutention?COSTS.handlingFee:0);
    const breakEven = variableCost + timeCost + fixedCost;
    const suggested = Math.max(COSTS.minPrice, breakEven*(1+COSTS.targetMargin), totalClient);

    return {
      vehicleId: v.id, vehicle: v.label, fuel: v.fuel,
      price: { distanceKm:r2(distanceKm), tarifKm:v.clientTarifKm, gasoilKm:r2(gasoilKm), prixDistance:r2(prixDistance), surchargePoids:r2(supPoids), manutention:manut, fraisFixes:fixed, totalHT:r2(totalClient) },
      cost: { breakEven:r2(breakEven), suggested:r2(suggested) },
      capacity: { maxKg:v.maxKg, maxM3:v.maxM3 },
      meta: { dieselPrice, consoL100 }
    };
  }).filter(Boolean).sort((a,b)=>a.cost.suggested-b.cost.suggested);
}

function renderOffers(offers){
  offersDiv.innerHTML='';
  offers.forEach((o, idx)=>{
    const tag = o.fuel==='electric' ? '<span class="tag">Électrique</span>' : '<span class="tag">Diesel</span>';
    const html = `
      <div class="offer">
        <h4>${o.vehicle} ${tag}</h4>
        <div class="rowline"><span>Prix distance</span><span>${o.price.distanceKm} km × (${o.price.tarifKm} + ${o.price.gasoilKm}) → ${o.price.prixDistance.toFixed(2)} €</span></div>
        <div class="rowline"><span>Supplément poids</span><span>${o.price.surchargePoids.toFixed(2)} €</span></div>
        <div class="rowline"><span>Manutention</span><span>${(o.price.manutention||0).toFixed(2)} €</span></div>
        <div class="rowline"><span>Frais fixes</span><span>${o.price.fraisFixes.toFixed(2)} €</span></div>
        <div class="rowline"><span>Seuil rentabilité</span><span>${o.cost.breakEven.toFixed(2)} €</span></div>
        <div class="rowline"><span class="price">Prix conseillé</span><span class="price">${o.cost.suggested.toFixed(2)} € HT</span></div>
        <div class="actions" style="justify-content:flex-end; margin-top:8px;">
          <button class="primary" data-idx="${idx}">Choisir cette offre</button>
        </div>
      </div>
    `;
    const wrap = document.createElement('div'); wrap.innerHTML=html; offersDiv.appendChild(wrap.firstElementChild);
  });
  offersDiv.querySelectorAll('button[data-idx]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const o = offers[Number(btn.dataset.idx)];
      chosenDiv.classList.remove('hidden');
      chosenDiv.innerHTML = `
        <h3>Devis retenu — ${o.vehicle}</h3>
        <div class="rowline"><span>Total HT conseillé</span><span><b>${o.cost.suggested.toFixed(2)} €</b></span></div>
        <div class="rowline"><span>Distance</span><span>${o.price.distanceKm} km</span></div>
        <div class="rowline"><span>Tarifs (km)</span><span>${o.price.tarifKm} + ${o.price.gasoilKm}</span></div>
        <div class="rowline"><span>Supplément poids</span><span>${o.price.surchargePoids.toFixed(2)} €</span></div>
        <div class="rowline"><span>Manutention</span><span>${(o.price.manutention||0).toFixed(2)} €</span></div>
        <div class="rowline"><span>Frais fixes</span><span>${o.price.fraisFixes.toFixed(2)} €</span></div>
        <div class="small">Diesel: ${o.meta.dieselPrice ? o.meta.dieselPrice.toFixed(2)+' €/L' : '—'} • Conso: ${o.meta.consoL100} L/100</div>
      `;
      chosenDiv.scrollIntoView({ behavior:'smooth' });
    });
  });
}

// Volume from dimensions
function volFromDims(L,W,H){ if(!L||!W||!H) return 0; if(L<=0||W<=0||H<=0) return 0; return (L*W*H)/1_000_000; }

// Fuel auto fetch (local asset fallback)
async function fetchFuelAuto(){
  try{
    // Local asset fallback (ships in repo; edit this file to update)
    const r = await fetch('./assets/fuel/fr-average.json', { cache:'no-store' });
    if (!r.ok) throw new Error('Local fuel not found');
    const data = await r.json();
    const price = Number(data.eur_per_liter);
    if (price>0){
      dieselPriceEl.value = price.toFixed(2);
      fuelMeta.textContent = `FR moyen: ${price.toFixed(2)} €/L • Maj: ${data.updated||'—'}`;
      localStorage.setItem('AME_DIESEL_PRICE', String(price));
      return price;
    }
  }catch(e){
    showToast('Mise à jour carburant indisponible — utilisez le mode manuel.');
  }
  return Number(dieselPriceEl.value||'0');
}

function updateFuelMode(){
  const isAuto = fuelAuto.checked;
  dieselPriceEl.disabled = isAuto;
  if (isAuto){ fetchFuelAuto(); }
  localStorage.setItem('AME_FUEL_MODE', isAuto?'auto':'manual');
}

fuelAuto.addEventListener('change', updateFuelMode);
fuelManual.addEventListener('change', updateFuelMode);
refreshFuelBtn.addEventListener('click', fetchFuelAuto);

// Load persisted prefs
(function initPrefs(){
  const savedMode = localStorage.getItem('AME_FUEL_MODE');
  if (savedMode==='manual'){ fuelManual.checked=true; fuelAuto.checked=false; }
  const savedPrice = localStorage.getItem('AME_DIESEL_PRICE');
  if (savedPrice){ dieselPriceEl.value = Number(savedPrice).toFixed(2); }
  updateFuelMode();
})();

resetBtn.addEventListener('click', ()=>{
  document.getElementById('origin').value = 'Grenoble';
  document.getElementById('destination').value = 'Lyon';
  document.getElementById('poids').value = '20';
  document.getElementById('volume').value = '0';
  document.getElementById('len').value = '0';
  document.getElementById('wid').value = '0';
  document.getElementById('hei').value = '0';
  document.getElementById('avoid').value = '';
  chosenDiv.classList.add('hidden'); chosenDiv.innerHTML='';
  result.classList.add('hidden'); offersDiv.innerHTML=''; volMeta.textContent=''; summary.textContent=''; routeMeta.textContent=''; trajet.textContent='';
  if (routeLine){ map.removeLayer(routeLine); routeLine=null; }
  if (straightLine){ map.removeLayer(straightLine); straightLine=null; }
  markers.forEach(m=>map.removeLayer(m)); markers=[];
  map.setView([46.6,2.5], 6);
});

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  goBtn.disabled=true; goBtn.textContent='Calcul...';
  try{
    const origin = document.getElementById('origin').value.trim();
    const destination = document.getElementById('destination').value.trim();
    const poids = parseFloat(document.getElementById('poids').value||'0');
    const volume = parseFloat(document.getElementById('volume').value||'0');
    const len = parseFloat(document.getElementById('len').value||'0');
    const wid = parseFloat(document.getElementById('wid').value||'0');
    const hei = parseFloat(document.getElementById('hei').value||'0');
    const manut = document.getElementById('manutention').value==='true';
    const avoid = document.getElementById('avoid').value;
    const consoTrafic = parseFloat(document.getElementById('consoTrafic').value||'8.5');
    const conso14 = parseFloat(document.getElementById('conso14').value||'11.5');
    const consoOverrides = { trafic: consoTrafic, m14: conso14 };
    const isAuto = fuelAuto.checked;
    let dieselPrice = Number(dieselPriceEl.value||'0');
    if (isAuto){ dieselPrice = await fetchFuelAuto(); }

    if(!origin||!destination||!poids||poids<=0){ showToast('Renseigne départ, arrivée et un poids valide.'); return; }

    const [o,d] = await Promise.all([geocode(origin), geocode(destination)]);
    updateMarkers(o,d);
    const rt = await osrmRoute(o,d,avoid);
    drawRoute(rt.geometry);
    summary.textContent = `Distance: ${rt.distanceKm} km • Durée: ${rt.durationMin} min`;
    trajet.textContent = `${o.label.split(',')[0]} → ${d.label.split(',')[0]}`;
    routeMeta.textContent = `Itinéraire: ${avoid===''?'Standard':(avoid==='motorway'?'Sans autoroutes':'Sans ferries')}`;

    const volDims = volFromDims(len,wid,hei);
    const volUsed = volDims>0?volDims:(volume>0?volume:0);
    volMeta.textContent = volUsed>0 ? `Volume pris en compte: ${volUsed.toFixed(3)} m³` : '';

    // Offers using real route distance
    const offers = computeOffers(rt.distanceKm, poids, volUsed, manut, dieselPrice, consoOverrides);
    result.classList.remove('hidden');
    renderOffers(offers);

    // Navigation buttons
    nav.style.display = 'flex';
    const oLab = encodeURIComponent(o.label), dLab = encodeURIComponent(d.label);
    aW.href = `https://waze.com/ul?ll=${d.lat},${d.lon}&from=${o.lat},${o.lon}&navigate=yes`;
    aG.href = `https://www.google.com/maps/dir/?api=1&origin=${oLab}&destination=${dLab}&travelmode=driving`;
    aA.href = `https://maps.apple.com/?saddr=${oLab}&daddr=${dLab}&dirflg=d`;

  }catch(err){
    console.error(err);
    showToast('Impossible de calculer le trajet (réessaye).');
  }finally{
    goBtn.disabled=false; goBtn.textContent='🚀 Obtenir les offres';
  }
});
