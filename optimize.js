
const OSRM = "https://router.project-osrm.org";
const LAYER_OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const LAYER_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ATTR_SAT = 'Tiles &copy; Esri & the GIS User Community';

// Map
const osm=L.tileLayer(LAYER_OSM,{maxZoom:19,attribution:'&copy; OpenStreetMap'});
const sat=L.tileLayer(LAYER_SAT,{maxZoom:19,attribution:ATTR_SAT});
const map=L.map('map',{zoomControl:false,layers:[osm]}).setView([46.6,2.5],6);
L.control.layers({ 'Plan':osm,'Satellite':sat }, null, {position:'topleft'}).addTo(map);
L.control.zoom({position:'bottomright'}).addTo(map);
// FS + GPS controls
const ctrlDiv=L.control({position:'topleft'});
ctrlDiv.onAdd=()=>{ const d=L.DomUtil.create('div'); d.style.display='flex'; d.style.gap='6px'; d.innerHTML='<button id="btnFS" class="primary" style="min-height:36px;padding:6px 10px;">⛶</button><button id="btnGPS" class="primary" style="min-height:36px;padding:6px 10px;">📍</button>'; return d; };
ctrlDiv.addTo(map);
document.addEventListener('click',(e)=>{ if(e.target?.id==='btnFS'){ const el=document.querySelector('.map-wrap'); if(!document.fullscreenElement){ el.requestFullscreen?.(); } else { document.exitFullscreen?.(); } } if(e.target?.id==='btnGPS'){ map.locate({setView:true,maxZoom:14}); } });
map.on('locationfound',(e)=>{ L.circleMarker(e.latlng,{radius:6,weight:2,opacity:.9}).addTo(map).bindPopup('Vous êtes ici').openPopup(); });

let routeLine=null, markers=[];
function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.style.display='block'; setTimeout(()=>t.style.display='none',2300); }

// Settings modal
const modal=document.getElementById('modalSettings'); const btnSettings=document.getElementById('btnSettings'); const saveSettings=document.getElementById('saveSettings'); const orsKeyInput=document.getElementById('orsKey');
btnSettings.addEventListener('click',()=>{ orsKeyInput.value=localStorage.getItem('AME_ORS_KEY')||''; modal.style.display='flex'; });
modal.addEventListener('click',(e)=>{ if(e.target===modal) modal.style.display='none'; });
saveSettings.addEventListener('click',()=>{ localStorage.setItem('AME_ORS_KEY', orsKeyInput.value.trim()); modal.style.display='none'; showToast('Clé ORS enregistrée'); });

// Autocomplete
function debounce(fn,ms){let t;return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);}}
async function suggest(q,dlId){ if(!q||q.trim().length<3) return; const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`); if(!r.ok) return; const d=await r.json(); document.getElementById(dlId).innerHTML=d.map(x=>`<option value="${x.display_name.replace(/"/g,'&quot;')}">`).join(''); }
const suggestDeb=debounce(suggest,250);
document.getElementById('origin').addEventListener('input',e=>suggestDeb(e.target.value,'dl-origin'));
document.getElementById('destination').addEventListener('input',e=>suggestDeb(e.target.value,'dl-dest'));

const stagesDiv=document.getElementById('stages'); let stageCount=0;
function addStage(val=""){ stageCount++; const id=`stage-${stageCount}`, dlid=`dl-${id}`; const w=document.createElement('div'); w.className='waypoint full'; w.style.display='flex'; w.style.alignItems='center'; w.innerHTML=`<label class="span3" style="flex:1">Étape ${stageCount}<input type="text" id="${id}" placeholder="Ex: Voiron Lycée Edouard Herriot" value="${val}" list="${dlid}"/><datalist id="${dlid}"></datalist></label><button type="button" class="rm" data-id="${id}">Supprimer</button>`; stagesDiv.appendChild(w); const input=w.querySelector('input'); input.addEventListener('input', e=>suggestDeb(e.target.value, dlid)); w.querySelector('.rm').addEventListener('click',()=>w.remove()); }
document.getElementById('addStage').addEventListener('click',()=>addStage());

// Geocode + cache
const geoCache=new Map();
async function geocodeOne(q){ if(geoCache.has(q)) return geoCache.get(q); const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`); if(!r.ok) throw new Error('Geocode fail'); const d=await r.json(); if(!d.length) throw new Error('Adresse introuvable: '+q); const v={lat:parseFloat(d[0].lat),lon:parseFloat(d[0].lon),label:d[0].display_name}; geoCache.set(q,v); return v; }

// Matrix engines
async function osrmMatrix(points){
  const coords=points.map(p=>`${p.lon},${p.lat}`).join(';');
  const r=await fetch(`${OSRM}/table/v1/driving/${coords}?annotations=distance`);
  if(!r.ok) throw new Error('OSRM table down');
  const d=await r.json();
  return d.distances.map(row=>row.map(v=> (v==null?Infinity: v/1000)));
}
async function orsMatrix(points){
  const key=localStorage.getItem('AME_ORS_KEY'); if(!key) throw new Error('ORS key manquante');
  const r=await fetch('https://api.openrouteservice.org/v2/matrix/driving-hgv', { method:'POST', headers:{'Content-Type':'application/json','Authorization':key}, body: JSON.stringify({ locations: points.map(p=>[p.lon,p.lat]), metrics:['distance'], units:'km' }) });
  if(!r.ok) throw new Error('ORS matrix down');
  const d=await r.json();
  return d.distances;
}

// Route engines
async function osrmRoute(points, avoid=''){ const coords=points.map(p=>`${p.lon},${p.lat}`).join(';'); const params=new URLSearchParams({overview:'full',geometries:'geojson'}); if(avoid) params.set('exclude', avoid); const url=`${OSRM}/route/v1/driving/${coords}?${params.toString()}`; const r=await fetch(url); if(!r.ok) throw new Error('OSRM route'); const d=await r.json(); const route=d.routes?.[0]; if(!route) throw new Error('route'); const latlngs=route.geometry.coordinates.map(([x,y])=>[y,x]); if(routeLine) map.removeLayer(routeLine); markers.forEach(m=>map.removeLayer(m)); markers=[]; points.forEach((p,i)=>{ const m=L.marker([p.lat,p.lon]).addTo(map).bindPopup(i===0?'Départ':(i===points.length-1?'Arrivée':`Étape ${i}`)); markers.push(m); }); routeLine=L.polyline(latlngs,{weight:5,opacity:.95}).addTo(map); map.fitBounds(routeLine.getBounds(),{padding:[40,40]}); return { distanceKm: Math.round(route.distance/10)/100, durationMin: Math.round(route.duration/60) }; }
async function orsRoute(points, avoid='', hazmat=false){ const key=localStorage.getItem('AME_ORS_KEY'); if(!key) throw new Error('ORS key manquante'); const body={ coordinates: points.map(p=>[p.lon,p.lat]), instructions:false }; const options={ avoid_features:[] }; if(avoid==='motorway') options.avoid_features.push('motorways'); if(avoid==='ferry') options.avoid_features.push('ferries'); if(hazmat){ options.avoid_features.push('tunnels'); body.profile_params={ hazardous_goods:true }; } if(Object.keys(options).length) body.options=options; const r=await fetch('https://api.openrouteservice.org/v2/directions/driving-hgv/geojson',{method:'POST',headers:{'Content-Type':'application/json','Authorization':key},body:JSON.stringify(body)}); if(!r.ok) throw new Error('ORS route'); const d=await r.json(); const feat=d.features?.[0]; if(!feat) throw new Error('ORS feat'); const latlngs=feat.geometry.coordinates.map(([x,y])=>[y,x]); if(routeLine) map.removeLayer(routeLine); markers.forEach(m=>map.removeLayer(m)); markers=[]; points.forEach((p,i)=>{ const m=L.marker([p.lat,p.lon]).addTo(map).bindPopup(i===0?'Départ':(i===points.length-1?'Arrivée':`Étape ${i}`)); markers.push(m); }); routeLine=L.polyline(latlngs,{weight:5,opacity:.95,color:'#78ffb7'}).addTo(map); map.fitBounds(routeLine.getBounds(),{padding:[40,40]}); const sum=feat.properties?.summary||{}; return { distanceKm: Math.round((sum.distance||0)/10)/100, durationMin: Math.round((sum.duration||0)/60) }; }

// Optim algo
function nearestNeighborOrder(M, startIndex, endIndex=null){ const n=M.length; let unvisited=[]; for(let i=0;i<n;i++){ if(i===startIndex) continue; if(endIndex!==null && i===endIndex) continue; unvisited.push(i);} const order=[startIndex]; let current=startIndex; while(unvisited.length){ let best=-1, bestD=Infinity, idx=-1; for(let k=0;k<unvisited.length;k++){ const j=unvisited[k]; const d=M[current][j]; if(d<bestD){best=j;bestD=d;idx=k;} } order.push(best); current=best; unvisited.splice(idx,1);} if(endIndex!==null) order.push(endIndex); return order; }
function twoOpt(order,M){ function tot(o){let s=0;for(let i=0;i<o.length-1;i++) s+=M[o[i]][o[i+1]];return s;} let best=order.slice(),bestD=tot(best),impr=true; while(impr){impr=false; for(let i=1;i<best.length-2;i++){ for(let k=i+1;k<best.length-1;k++){ const cand=best.slice(0,i).concat(best.slice(i,k+1).reverse(),best.slice(k+1)); const d=tot(cand); if(d+1e-6<bestD){best=cand;bestD=d;impr=true;} } } } return best; }

// Submit
document.getElementById('tour-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const originQ=document.getElementById('origin').value.trim();
  const destQ=document.getElementById('destination').value.trim();
  const avoid=document.getElementById('avoid').value;
  const truck=document.getElementById('truck').value==='true';
  const hazmat=document.getElementById('hazmat').value==='true';
  if(!originQ){ showToast('Saisir un départ'); return; }
  const inputs=Array.from(document.querySelectorAll('#stages input[type=text]')); const stagesQ=inputs.map(i=>i.value.trim()).filter(Boolean);
  const btn=document.getElementById('optimizeBtn'); const label=document.getElementById('optLabel'); btn.disabled=true; label.textContent='Calcul...';

  try{
    const origin=await geocodeOne(originQ); const stops=[]; for(const s of stagesQ){ stops.push(await geocodeOne(s)); }
    let points=[]; if(destQ){ const dest=await geocodeOne(destQ); points=[origin,...stops,dest]; } else { points=[origin,...stops,origin]; }
    // Matrix for order
    let M;
    if(truck || hazmat){
      try{ M = await orsMatrix(points); } catch(e){ showToast('Matrix PL indisponible — optimisation approximative'); M = await osrmMatrix(points); }
    } else { M = await osrmMatrix(points); }
    let order=nearestNeighborOrder(M,0,points.length-1); order=twoOpt(order,M); const optimized=order.map(i=>points[i]);
    // Route
    let info;
    if(truck || hazmat){
      try{ info = await orsRoute(optimized, avoid, hazmat); document.getElementById('summary').textContent='Profil: PL'+(hazmat?' + ADR':''); }
      catch(e){ showToast('ORS indisponible — itinéraire voiture'); info = await osrmRoute(optimized, avoid); document.getElementById('summary').textContent='Profil: Voiture (fallback)'; }
    } else { info = await osrmRoute(optimized, avoid); document.getElementById('summary').textContent='Profil: Voiture'; }
    document.getElementById('statOrder').textContent = 'Ordre: ' + optimized.map((p,i)=> (i===0?'Départ':(i===optimized.length-1?'Arrivée':`É${i}`))).join(' → ');
    document.getElementById('statDist').textContent = `Distance: ${info.distanceKm} km`;
    document.getElementById('statDur').textContent = `Durée: ${info.durationMin} min`;
    // Nav links
    const nav=document.getElementById('navActions'); const g=document.getElementById('navGmaps'); const a=document.getElementById('navApple'); const w=document.getElementById('navWaze'); nav.style.display='flex';
    const enc=s=>encodeURIComponent(s); const o=optimized[0], d=optimized.at(-1); const wps=optimized.slice(1,-1).map(p=>p.label||`${p.lat},${p.lon}`);
    g.href=`https://www.google.com/maps/dir/?api=1&origin=${enc(o.label||`${o.lat},${o.lon}`)}&destination=${enc(d.label||`${d.lat},${d.lon}`)}&travelmode=driving&waypoints=${enc(wps.join('|'))}`;
    a.href=`https://maps.apple.com/?saddr=${enc(o.label||`${o.lat},${o.lon}`)}&daddr=${enc((wps.concat([d.label||`${d.lat},${d.lon}`])).join(' to:'))}`;
    w.href=`https://waze.com/ul?ll=${d.lat},${d.lon}&navigate=yes`;
  }catch(err){ console.error(err); showToast('Optimisation impossible'); }
  finally{ btn.disabled=false; label.textContent='🚀 Optimiser la tournée'; }
});

document.getElementById('resetBtn').addEventListener('click',()=>{
  stagesDiv.innerHTML=''; stageCount=0; if(routeLine){map.removeLayer(routeLine);routeLine=null;} markers.forEach(m=>map.removeLayer(m)); markers=[];
  document.getElementById('statOrder').textContent='Ordre: -'; document.getElementById('statDist').textContent='Distance: -'; document.getElementById('statDur').textContent='Durée: -';
  document.getElementById('summary').textContent=''; document.getElementById('navActions').style.display='none';
});
