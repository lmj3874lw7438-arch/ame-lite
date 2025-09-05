
const OSRM = "https://router.project-osrm.org";
const LAYER_OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const LAYER_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ATTR_SAT = 'Tiles &copy; Esri & the GIS User Community';

// Map + layers
const osm = L.tileLayer(LAYER_OSM,{maxZoom:19,attribution:'&copy; OpenStreetMap'});
const sat = L.tileLayer(LAYER_SAT,{maxZoom:19,attribution:ATTR_SAT});
const map = L.map('map',{zoomControl:false,layers:[osm]}).setView([46.6,2.5],6);
L.control.layers({ 'Plan':osm, 'Satellite':sat }, null, {position:'topleft'}).addTo(map);
L.control.zoom({position:'bottomright'}).addTo(map);
// FS + GPS controls
const ctrlDiv = L.control({position:'topleft'});
ctrlDiv.onAdd=()=>{ const d=L.DomUtil.create('div'); d.style.display='flex'; d.style.gap='6px';
 d.innerHTML='<button id="btnFS" title="Plein écran" class="primary" style="min-height:36px;padding:6px 10px;">⛶</button><button id="btnGPS" title="Ma position" class="primary" style="min-height:36px;padding:6px 10px;">📍</button>'; return d; };
ctrlDiv.addTo(map);
document.addEventListener('click',(e)=>{
 if(e.target?.id==='btnFS'){ const el=document.querySelector('.map-wrap'); if(!document.fullscreenElement){ el.requestFullscreen?.(); } else { document.exitFullscreen?.(); } }
 if(e.target?.id==='btnGPS'){ map.locate({setView:true,maxZoom:14}); }
});
map.on('locationfound', (e)=>{ L.circleMarker(e.latlng,{radius:6,weight:2,opacity:.9}).addTo(map).bindPopup('Vous êtes ici').openPopup(); });

let markers=[], routeLine=null;
function clearMap(){ markers.forEach(m=>map.removeLayer(m)); markers=[]; if(routeLine){map.removeLayer(routeLine); routeLine=null;} }
function addMarker(p, label){ const m=L.marker([p.lat,p.lon]).addTo(map).bindPopup(label); markers.push(m); }
function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.style.display='block'; setTimeout(()=>t.style.display='none',2300); }
const r2=x=>Math.round(x*100)/100;

// Settings modal (ORS key)
const modal=document.getElementById('modalSettings'); const btnSettings=document.getElementById('btnSettings'); const saveSettings=document.getElementById('saveSettings'); const orsKeyInput=document.getElementById('orsKey');
btnSettings.addEventListener('click',()=>{ orsKeyInput.value=localStorage.getItem('AME_ORS_KEY')||''; modal.style.display='flex'; });
modal.addEventListener('click',(e)=>{ if(e.target===modal) modal.style.display='none'; });
saveSettings.addEventListener('click',()=>{ localStorage.setItem('AME_ORS_KEY', orsKeyInput.value.trim()); modal.style.display='none'; showToast('Clé ORS enregistrée'); });

// Autocomplete with debounce
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
async function suggest(q,dlId){ if(!q||q.trim().length<3) return; const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`); if(!r.ok) return; const d=await r.json(); document.getElementById(dlId).innerHTML=d.map(x=>`<option value="${x.display_name.replace(/"/g,'&quot;')}">`).join(''); }
const suggestDeb = debounce(suggest, 250);
document.getElementById('origin').addEventListener('input', e=>suggestDeb(e.target.value,'dl-origin'));
document.getElementById('destination').addEventListener('input', e=>suggestDeb(e.target.value,'dl-dest'));

const stagesDiv = document.getElementById('stages');
let stageCount=0;
function addStage(val=""){ stageCount++; const id=`stage-${stageCount}`, dlid=`dl-${id}`;
  const wrap=document.createElement('div'); wrap.className='waypoint full'; wrap.style.display='flex'; wrap.style.alignItems='center';
  wrap.innerHTML=`<label class="span3" style="flex:1">Étape ${stageCount}
      <input type="text" id="${id}" placeholder="Ex: Voiron Lycée Edouard Herriot" value="${val}" list="${dlid}"/>
      <datalist id="${dlid}"></datalist>
    </label><button type="button" class="rm" data-id="${id}">Supprimer</button>`;
  stagesDiv.appendChild(wrap); const input=wrap.querySelector('input'); input.addEventListener('input', e=>suggestDeb(e.target.value, dlid)); wrap.querySelector('.rm').addEventListener('click',()=>wrap.remove());
}
document.getElementById('addStage').addEventListener('click', ()=>addStage());

// Geocode + cache
const geoCache = new Map();
async function geocodeOne(q){ if(geoCache.has(q)) return geoCache.get(q); const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`); if(!r.ok) throw new Error('Geocode fail'); const d=await r.json(); if(!d.length) throw new Error('Adresse introuvable: '+q); const v={lat:parseFloat(d[0].lat),lon:parseFloat(d[0].lon),label:d[0].display_name}; geoCache.set(q,v); return v; }

// Engines
async function osrmRouteMulti(points, avoid=""){ const coords=points.map(p=>`${p.lon},${p.lat}`).join(';'); const params=new URLSearchParams({overview:'full',geometries:'geojson'}); if(avoid) params.set('exclude', avoid); const url=`${OSRM}/route/v1/driving/${coords}?${params.toString()}`; const r=await fetch(url); if(!r.ok){ throw new Error('OSRM route down'); } const d=await r.json(); if(!d.routes?.length) throw new Error('Route introuvable'); const route=d.routes[0]; const latlngs=route.geometry.coordinates.map(([x,y])=>[y,x]); routeLine = L.polyline(latlngs,{weight:5,opacity:.95}).addTo(map); map.fitBounds(routeLine.getBounds(),{padding:[40,40]}); return { distanceKm: r2(route.distance/1000), durationMin: Math.round(route.duration/60) }; }

async function orsRouteMulti(points, opts){ const key=localStorage.getItem('AME_ORS_KEY'); if(!key) throw new Error('ORS key manquante'); const body={ coordinates: points.map(p=>[p.lon,p.lat]), instructions:false }; const options={ avoid_features:[] }; if(opts?.avoid==='motorway') options.avoid_features.push('motorways'); if(opts?.avoid==='ferry') options.avoid_features.push('ferries'); if(opts?.hazmat){ options.avoid_features.push('tunnels'); body.profile_params={ hazardous_goods:true }; } if(Object.keys(options).length) body.options=options; const r=await fetch('https://api.openrouteservice.org/v2/directions/driving-hgv/geojson',{ method:'POST', headers:{'Content-Type':'application/json','Authorization':key}, body: JSON.stringify(body)}); if(!r.ok) throw new Error('ORS route down'); const d=await r.json(); const feat=d.features?.[0]; if(!feat) throw new Error('ORS route vide'); const latlngs=feat.geometry.coordinates.map(([x,y])=>[y,x]); routeLine = L.polyline(latlngs,{weight:5,opacity:.95,color:'#78ffb7'}).addTo(map); map.fitBounds(routeLine.getBounds(),{padding:[40,40]}); const sum=feat.properties?.summary||{}; return { distanceKm: r2((sum.distance||0)/1000), durationMin: Math.round((sum.duration||0)/60) }; }

// Pricing (identique)
const VEHICLES=[
  { id:'ev-city',   label:'Citadine électrique', clientTarifKm:0.90, maxKg:150,  maxM3:0.5, fuel:'electric', costPerKm:0.20, consoL100:0 },
  { id:'van-trafic',label:'Fourgonnette (Trafic)', clientTarifKm:1.50, maxKg:900,  maxM3:6,   fuel:'diesel',   costPerKm:0.50, consoL100:8.5 },
  { id:'van-14m3',  label:'14 m³ rallongé (Master)', clientTarifKm:1.80, maxKg:1200, maxM3:14,  fuel:'diesel',   costPerKm:0.65, consoL100:11.5 },
];
const COSTS={ driverPerHour:25, jobFixed:5, handlingFee:25, avgSpeedKmh:60, targetMargin:0.15, minPrice:25 };
const surchargePoids=(p,prix)=> p>1000?prix*.30:p>500?prix*.20:p>100?prix*.10:0;
const gasoilKmFrom=(price, conso)=> (!price||!conso)?0:(conso/100)*price;
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

function buildNavLinks(points){
  nav.style.display='flex';
  const enc=s=>encodeURIComponent(s);
  const o = points[0], d = points.at(-1);
  const oL=o.label||`${o.lat},${o.lon}`, dL=d.label||`${d.lat},${d.lon}`;
  const wps = points.slice(1,-1).map(p=> p.label || `${p.lat},${p.lon}`);
  navG.href = `https://www.google.com/maps/dir/?api=1&origin=${enc(oL)}&destination=${enc(dL)}&travelmode=driving&waypoints=${enc(wps.join('|'))}`;
  navA.href = `https://maps.apple.com/?saddr=${enc(oL)}&daddr=${enc((wps.concat([dL])).join(' to:'))}`;
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
  const inputs=Array.from(document.querySelectorAll('#stages input[type=text]')); const stagesQ=inputs.map(i=>i.value.trim()).filter(Boolean);
  const poids=parseFloat(document.getElementById('poids').value||'0');
  const volume=parseFloat(document.getElementById('volume').value||'0');
  const len=parseFloat(document.getElementById('len').value||'0'); const wid=parseFloat(document.getElementById('wid').value||'0'); const hei=parseFloat(document.getElementById('hei').value||'0');
  const manut=document.getElementById('manutention').value==='true';
  const avoid=document.getElementById('avoid').value;
  const truck=document.getElementById('truck').value==='true';
  const hazmat=document.getElementById('hazmat').value==='true';
  const dieselPrice=parseFloat(document.getElementById('dieselPrice').value||'0');
  const consoTrafic=parseFloat(document.getElementById('consoTrafic').value||'8.5');
  const conso14=parseFloat(document.getElementById('conso14').value||'11.5');
  if(!originQ||!destinationQ||!poids||poids<=0){ showToast('Remplis Départ, Arrivée et Poids.'); return; }
  const volDims=(len>0&&wid>0&&hei>0)?(len*wid*hei)/1_000_000:0; const volUsed=volDims>0?volDims:(volume>0?volume:0); if(volUsed>0) volMeta.textContent=`Volume pris en compte: ${volUsed.toFixed(3)} m³`;

  const goBtn=document.getElementById('goBtn'); const goLabel=document.getElementById('goLabel'); goBtn.disabled=true; goLabel.textContent='Calcul...';
  try{
    const origin=await geocodeOne(originQ); const dest=await geocodeOne(destinationQ);
    const waypoints=[]; for(const s of stagesQ){ waypoints.push(await geocodeOne(s)); }
    clearMap(); addMarker(origin,'Départ'); waypoints.forEach((p,i)=>addMarker(p,`Étape ${i+1}`)); addMarker(dest,'Arrivée');
    const points=[origin, ...waypoints, dest];
    let info;
    if((truck||hazmat) && localStorage.getItem('AME_ORS_KEY')){
      info = await orsRouteMulti(points,{avoid,hazmat});
      routeMeta.textContent='Profil: Poids lourd'+(hazmat?' + ADR':'');
    }else{
      if(truck||hazmat) showToast('Clé ORS manquante — itinéraire voiture utilisé.');
      info = await osrmRouteMulti(points, avoid);
      routeMeta.textContent='Profil: Voiture (OSRM)';
    }
    summary.textContent=`Distance: ${info.distanceKm} km • Durée: ${info.durationMin} min`;
    trajet.textContent=`${origin.label.split(',')[0]} → ${dest.label.split(',')[0]} (${waypoints.length} étape(s))`;
    const offers=computeOffers(info.distanceKm, poids, volUsed, manut, dieselPrice, {trafic:consoTrafic, m14:conso14});
    result.style.display='block'; renderOffers(offers); buildNavLinks(points);
  }catch(err){ console.error(err); showToast('Calcul impossible (réseau/API)'); }
  finally{ goBtn.disabled=false; goLabel.textContent='Obtenir les offres'; }
});
