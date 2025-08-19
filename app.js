
// Client-only V8.2: uses Nominatim + OSRM directly from the browser (no backend).

const toast = document.getElementById('toast');
function showToast(msg){ toast.textContent=msg; toast.style.display='block'; setTimeout(()=>toast.style.display='none', 3000); }

// Map init
const map = L.map('map', { zoomControl: false }).setView([46.6, 2.5], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
L.control.zoom({ position:'bottomright' }).addTo(map);
let markers=[], routeLine=null;

function setMarkers(a,b){
  markers.forEach(m=>map.removeLayer(m)); markers=[];
  const m1=L.marker([a.lat,a.lon]).addTo(map).bindPopup('Départ'); 
  const m2=L.marker([b.lat,b.lon]).addTo(map).bindPopup('Arrivée');
  markers=[m1,m2];
}
function drawRoute(coords){
  if(routeLine){ map.removeLayer(routeLine); routeLine=null; }
  const latlngs = coords.map(([lon,lat])=>[lat,lon]);
  routeLine = L.polyline(latlngs, { weight:5, opacity:.95 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding:[40,40] });
}

async function geocode(q){
  const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {headers:{'Accept':'application/json'}});
  if(!r.ok) throw new Error('Geocoding error');
  const d=await r.json();
  if(!Array.isArray(d)||!d.length) throw new Error('Adresse introuvable');
  const {lat,lon,display_name}=d[0];
  return { lat:parseFloat(lat), lon:parseFloat(lon), label:display_name };
}

async function routeOSRM(a,b, avoid=''){
  const params = new URLSearchParams({ overview:'full', geometries:'geojson', steps:'false', alternatives:'false' });
  if(avoid) params.set('exclude', avoid);
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?${params.toString()}`;
  const r = await fetch(url, {headers:{'Accept':'application/json'}});
  if(!r.ok) throw new Error('OSRM error');
  const data = await r.json();
  if(!data.routes || !data.routes.length) throw new Error('Aucune route trouvée');
  const route = data.routes[0];
  return { distanceKm: Math.round(route.distance/10)/100, durationMin: Math.round(route.duration/60), geometry: route.geometry };
}

// UI refs
const form = document.getElementById('quote-form');
const goBtn = document.getElementById('goBtn'); const goLabel = document.getElementById('goLabel');
const resetBtn = document.getElementById('resetBtn');
const result = document.getElementById('result'); const offersDiv = document.getElementById('offers');
const chosenDiv = document.getElementById('chosen');
const trajet = document.getElementById('trajet'); const routeMeta = document.getElementById('routeMeta'); const volMeta = document.getElementById('volMeta'); const summary = document.getElementById('summary');

const VEHICLES=[
  { id:'ev-city', label:'Citadine électrique', clientTarifKm:0.90, gasoilKm:0,    maxKg:150,  maxM3:0.5, fuel:'electric', costPerKm:0.20 },
  { id:'van-trafic', label:'Fourgonnette (Trafic)', clientTarifKm:1.50, gasoilKm:0.20, maxKg:900,  maxM3:6,   fuel:'diesel',   costPerKm:0.50 },
  { id:'van-14m3', label:'14 m³ rallongé (Master)', clientTarifKm:1.80, gasoilKm:0.25, maxKg:1200, maxM3:14,  fuel:'diesel',   costPerKm:0.65 },
];
const COSTS={ driverPerHour:25, jobFixed:5, handlingFee:25, avgSpeedKmh:60, targetMargin:0.15, minPrice:25 };
const r2 = x=>Math.round(x*100)/100;
const surchargePoids=(p,prix)=> p>1000?prix*.30:p>500?prix*.20:p>100?prix*.10:0;

function computeOffers(distanceKm, poidsKg, volumeM3, manutention){
  const hours=distanceKm/COSTS.avgSpeedKmh;
  return VEHICLES.map(v=>{
    if(poidsKg&&v.maxKg&&poidsKg>v.maxKg) return null;
    if(volumeM3&&v.maxM3&&volumeM3>v.maxM3) return null;
    const prixDistance=distanceKm*(v.clientTarifKm+v.gasoilKm);
    const supPoids=surchargePoids(poidsKg,prixDistance);
    const manut=manutention?COSTS.handlingFee:0;
    const fixed=COSTS.jobFixed;
    const totalClient=prixDistance+supPoids+manut+fixed;
    const variableCost=v.costPerKm*distanceKm;
    const timeCost=COSTS.driverPerHour*hours;
    const fixedCost=COSTS.jobFixed+(manutention?COSTS.handlingFee:0);
    const breakEven=variableCost+timeCost+fixedCost;
    const suggested=Math.max(COSTS.minPrice,breakEven*(1+COSTS.targetMargin),totalClient);
    return {vehicleId:v.id,vehicle:v.label,fuel:v.fuel,
      price:{distanceKm:r2(distanceKm),tarifKm:v.clientTarifKm,gasoilKm:v.gasoilKm,prixDistance:r2(prixDistance),surchargePoids:r2(supPoids),manutention:manut,fraisFixes:fixed,totalHT:r2(totalClient)},
      cost:{breakEven:r2(breakEven),suggested:r2(suggested)},
      capacity:{maxKg:v.maxKg,maxM3:v.maxM3}};
  }).filter(Boolean).sort((a,b)=>a.cost.suggested-b.cost.suggested);
}

function renderOffers(offers){
  offersDiv.innerHTML='';
  offers.forEach((o, idx)=>{
    const tag=o.fuel==='electric'?'<span class="tag">Électrique</span>':'<span class="tag">Diesel</span>';
    const html=`
      <div class="offer">
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
      const o=offers[Number(btn.dataset.idx)];
      chosenDiv.style.display='block';
      chosenDiv.innerHTML=`
        <h3>Devis retenu — ${o.vehicle}</h3>
        <div class="row"><span>Total HT conseillé</span><span><b>${o.cost.suggested.toFixed(2)} €</b></span></div>
        <div class="row"><span>Distance</span><span>${o.price.distanceKm} km</span></div>
        <div class="row"><span>Tarifs (km)</span><span>${o.price.tarifKm} + ${o.price.gasoilKm}</span></div>
        <div class="row"><span>Supplément poids</span><span>${o.price.surchargePoids.toFixed(2)} €</span></div>
        <div class="row"><span>Manutention</span><span>${(o.price.manutention||0).toFixed(2)} €</span></div>
        <div class="row"><span>Frais fixes</span><span>${o.price.fraisFixes.toFixed(2)} €</span></div>
        <div style="margin-top:8px" class="meta">Seuil de rentabilité: ${o.cost.breakEven.toFixed(2)} € • Marge cible incluse 15%</div>`;
      chosenDiv.scrollIntoView({behavior:'smooth'});
    });
  });
}

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  chosenDiv.style.display='none'; chosenDiv.innerHTML='';
  offersDiv.innerHTML=''; result.style.display='none'; volMeta.textContent='';
  const origin=document.getElementById('origin').value.trim();
  const destination=document.getElementById('destination').value.trim();
  const poids=parseFloat(document.getElementById('poids').value||'0');
  const volume=parseFloat(document.getElementById('volume').value||'0');
  const len=parseFloat(document.getElementById('len').value||'0');
  const wid=parseFloat(document.getElementById('wid').value||'0');
  const hei=parseFloat(document.getElementById('hei').value||'0');
  const manut=document.getElementById('manutention').value==='true';
  const avoid=document.getElementById('avoid').value;
  if(!origin||!destination||!poids||poids<=0){ showToast('Complète départ, arrivée et poids.'); return; }
  const volDims=(len>0&&wid>0&&hei>0)?(len*wid*hei)/1_000_000:0;
  const volUsed=volDims>0?volDims:(volume>0?volume:0);
  if(volUsed>0) volMeta.textContent=`Volume pris en compte: ${volUsed.toFixed(3)} m³`;

  goBtn.disabled=true; goLabel.textContent='Calcul...';
  try{
    const [o,d]=await Promise.all([geocode(origin),geocode(destination)]);
    setMarkers(o,d);
    const rt = await routeOSRM(o,d,avoid);
    drawRoute(rt.geometry.coordinates);
    summary.textContent = `Distance: ${rt.distanceKm} km • Durée: ${rt.durationMin} min`;
    trajet.textContent = `${o.label.split(',')[0]} → ${d.label.split(',')[0]}`;
    routeMeta.textContent = `Itinéraire: ${avoid===''?'Standard':(avoid==='motorway'?'Sans autoroutes':'Sans ferries')}`;
    const offers=computeOffers(rt.distanceKm, poids, volUsed, manut);
    result.style.display='block';
    renderOffers(offers);
  }catch(err){
    console.error(err);
    showToast('Routage indisponible, réessaie.');
  }finally{
    goBtn.disabled=false; goLabel.textContent='Obtenir les offres';
  }
});

resetBtn.addEventListener('click', ()=>{
  document.getElementById('quote-form').reset();
  offersDiv.innerHTML=''; chosenDiv.style.display='none'; result.style.display='none'; summary.textContent='';
  if(routeLine){ map.removeLayer(routeLine); routeLine=null; }
  markers.forEach(m=>map.removeLayer(m)); markers=[];
  map.setView([46.6, 2.5], 6);
});
