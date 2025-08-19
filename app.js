
const BACKEND_URL = 'http://localhost:4000'; // change to deployed API if needed

// Map
const map = L.map('map', { zoomControl: false }).setView([46.6, 2.5], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
L.control.zoom({ position:'bottomright' }).addTo(map);
let markers=[], polyline=null;
function updateMap(a,b){ markers.forEach(m=>map.removeLayer(m)); if(polyline) map.removeLayer(polyline);
  const m1=L.marker([a.lat,a.lon]).addTo(map).bindPopup('Départ'); const m2=L.marker([b.lat,b.lon]).addTo(map).bindPopup('Arrivée');
  markers=[m1,m2]; polyline=L.polyline([[a.lat,a.lon],[b.lat,b.lon]], {weight:4,opacity:.85}).addTo(map);
  map.fitBounds(polyline.getBounds(), {padding:[40,40]}); }

// UI
const form = document.getElementById('quote-form');
const goBtn = document.getElementById('goBtn'); const goLabel = document.getElementById('goLabel');
const result = document.getElementById('result'); const offersDiv = document.getElementById('offers');
const chosenDiv = document.getElementById('chosen');
const trajet = document.getElementById('trajet'); const routeMeta = document.getElementById('routeMeta'); const volMeta = document.getElementById('volMeta'); const summary = document.getElementById('summary');

// Helpers
function toRad(d){return d*Math.PI/180}
function haversine(a,b,c,d){const R=6371,dl=toRad(c-a),dn=toRad(d-b);const x=Math.sin(dl/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dn/2)**2;return R*(2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)));}
async function geocode(q){const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`); if(!r.ok) throw new Error('Geocode'); const d=await r.json(); if(!Array.isArray(d)||!d.length) throw new Error('No addr'); const {lat,lon,display_name}=d[0]; return {lat:parseFloat(lat),lon:parseFloat(lon),label:display_name};}
const r2=x=>Math.round(x*100)/100;

const VEHICLES=[
  { id:'ev-city', label:'Citadine électrique', clientTarifKm:0.90, gasoilKm:0,    maxKg:150,  maxM3:0.5, fuel:'electric', costPerKm:0.20 },
  { id:'van-trafic', label:'Fourgonnette (Trafic)', clientTarifKm:1.50, gasoilKm:0.20, maxKg:900,  maxM3:6,   fuel:'diesel',   costPerKm:0.50 },
  { id:'van-14m3', label:'14 m³ rallongé (Master)', clientTarifKm:1.80, gasoilKm:0.25, maxKg:1200, maxM3:14,  fuel:'diesel',   costPerKm:0.65 },
];
const COSTS={ driverPerHour:25, jobFixed:5, handlingFee:25, avgSpeedKmh:60, targetMargin:0.15, minPrice:25 };
const surchargePoids=(p,prix)=> p>1000?prix*.30:p>500?prix*.20:p>100?prix*.10:0;

function computeLocalOffers(distanceKm, poidsKg, volumeM3, manutention){
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

function renderOffers(data){
  offersDiv.innerHTML='';
  data.offers.forEach((o, idx)=>{
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
        <div style="margin-top:8px" class="meta">Seuil de rentabilité: ${o.cost.breakEven.toFixed(2)} € • Marge cible incluse 15%</div>`;
      chosenDiv.scrollIntoView({behavior:'smooth'});
    });
  });
}

function volFromDims(L,W,H){ if(!L||!W||!H) return 0; if(L<=0||W<=0||H<=0) return 0; return (L*W*H)/1_000_000; }

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  result.style.display='none'; offersDiv.innerHTML=''; chosenDiv.style.display='none'; chosenDiv.innerHTML=''; volMeta.textContent='';
  const origin=document.getElementById('origin').value.trim();
  const destination=document.getElementById('destination').value.trim();
  const poids=parseFloat(document.getElementById('poids').value||'0');
  const volume=parseFloat(document.getElementById('volume').value||'0');
  const len=parseFloat(document.getElementById('len').value||'0');
  const wid=parseFloat(document.getElementById('wid').value||'0');
  const hei=parseFloat(document.getElementById('hei').value||'0');
  const manut=document.getElementById('manutention').value==='true';
  if(!origin||!destination||!poids||poids<=0){ alert('Merci de saisir une origine, une destination et un poids valide.'); return; }
  const volDims=volFromDims(len,wid,hei);
  const volUsed=volDims>0?volDims:(volume>0?volume:0);
  if(volUsed>0) volMeta.textContent=`Volume pris en compte: ${volUsed.toFixed(3)} m³`;

  goBtn.disabled=true; goLabel.textContent='Calcul...';
  try{
    const r=await fetch(`${BACKEND_URL}/quote`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin,destination,poidsKg:poids,volumeM3:volUsed,lengthCm:len,widthCm:wid,heightCm:hei,manutention:manut})});
    if(!r.ok) throw new Error('API KO');
    const data=await r.json();
    updateMap(data.origin, data.destination);
    summary.textContent=`Distance: ${data.route.distanceKm} km • Durée: ${data.route.durationMin} min`;
    trajet.textContent=`${data.origin.label.split(',')[0]} → ${data.destination.label.split(',')[0]}`;
    routeMeta.textContent=`Offres trouvées: ${data.offers.length}`;
    if(data.inputs?.volumeM3>0) volMeta.textContent=`Volume pris en compte: ${Number(data.inputs.volumeM3).toFixed(3)} m³`;
    result.style.display='block';
    renderOffers(data);
  }catch{
    try{
      const [o,d]=await Promise.all([geocode(origin),geocode(destination)]);
      updateMap(o,d);
      const dist=r2(haversine(o.lat,o.lon,d.lat,d.lon));
      summary.textContent=`Distance (local): ${dist} km`;
      trajet.textContent=`${o.label.split(',')[0]} → ${d.label.split(',')[0]}`;
      routeMeta.textContent=`Mode local (API indisponible)`;
      if(volUsed>0) volMeta.textContent=`Volume pris en compte: ${volUsed.toFixed(3)} m³`;
      const offers=computeLocalOffers(dist, poids, volUsed, manut);
      result.style.display='block';
      renderOffers({offers});
    }catch(e2){
      alert('Impossible de calculer le devis pour le moment.'); console.error(e2);
    }
  }finally{
    goBtn.disabled=false; goLabel.textContent='Obtenir les offres';
  }
});
