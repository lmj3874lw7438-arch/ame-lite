
const OSRM = "https://router.project-osrm.org";
const LAYER = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

// Map
const map = L.map('map',{zoomControl:false}).setView([46.6,2.5],6);
L.tileLayer(LAYER,{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
L.control.zoom({position:'bottomright'}).addTo(map);
let routeLine=null, markers=[];
function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.style.display='block'; setTimeout(()=>t.style.display='none',2200);}

// Debounced autocomplete + cache
function debounce(fn, ms){ let t; return (...a)=>{clearTimeout(t); t=setTimeout(()=>fn(...a),ms);}}
const geoCache = new Map();
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

const stagesDiv = document.getElementById('stages');
let stageCount=0;
function addStage(val=""){
  stageCount++; const id=`stage-${stageCount}`, dlid=`dl-${id}`;
  const wrap=document.createElement('div');
  wrap.className='waypoint full';
  wrap.innerHTML=`<label class="span3" style="flex:1">Étape ${stageCount}
      <input type="text" id="${id}" placeholder="Ex: Voiron Lycée Edouard Herriot" value="${val}" list="${dlid}"/>
      <datalist id="${dlid}"></datalist>
    </label>
    <button type="button" class="rm" data-id="${id}">Supprimer</button>`;
  stagesDiv.appendChild(wrap);
  const input=wrap.querySelector('input'); input.addEventListener('input', e=>suggestDeb(e.target.value, dlid));
  wrap.querySelector('.rm').addEventListener('click', ()=>wrap.remove());
}
document.getElementById('addStage').addEventListener('click', ()=>addStage());

async function geocodeOne(q){
  if(geoCache.has(q)) return geoCache.get(q);
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
  if(!r.ok) throw new Error('Geocoding failed');
  const d = await r.json(); if(!Array.isArray(d)||!d.length) throw new Error('Adresse introuvable: '+q);
  const v = { lat:parseFloat(d[0].lat), lon:parseFloat(d[0].lon), label:d[0].display_name };
  geoCache.set(q, v); return v;
}

// Matrix via OSRM table (meters -> km) with single call
async function osrmTable(points){
  const coords = points.map(p=>`${p.lon},${p.lat}`).join(';');
  const url = `${OSRM}/table/v1/driving/${coords}?annotations=distance`;
  const r = await fetch(url);
  if(!r.ok) throw new Error('OSRM table down');
  const d = await r.json();
  if(!d || !d.distances) throw new Error('No matrix');
  return d.distances.map(row=>row.map(v=> (v==null?Infinity: v/1000)));
}

// 2-Opt helpers
function nearestNeighborOrder(M, startIndex, endIndex=null){
  const n=M.length;
  let unvisited=[];
  for(let i=0;i<n;i++){ if(i===startIndex) continue; if(endIndex!==null&&i===endIndex) continue; unvisited.push(i); }
  const order=[startIndex]; let current=startIndex;
  while(unvisited.length){
    let best=-1, bestD=Infinity, idx=-1;
    for(let k=0;k<unvisited.length;k++){ const j=unvisited[k]; const d=M[current][j]; if(d<bestD){best=j;bestD=d;idx=k;} }
    order.push(best); current=best; unvisited.splice(idx,1);
  }
  if(endIndex!==null) order.push(endIndex);
  return order;
}
function twoOpt(order, M){
  function tot(o){ let s=0; for(let i=0;i<o.length-1;i++) s+=M[o[i]][o[i+1]]; return s; }
  let best=order.slice(), bestD=tot(best), improved=true;
  while(improved){
    improved=false;
    for(let i=1;i<best.length-2;i++){
      for(let k=i+1;k<best.length-1;k++){
        const cand = best.slice(0,i).concat(best.slice(i,k+1).reverse(), best.slice(k+1));
        const d = tot(cand);
        if(d + 1e-6 < bestD){ best=cand; bestD=d; improved=true; }
      }
    }
  }
  return best;
}

// Route display
async function drawRoute(points, avoid=""){
  if(routeLine){ map.removeLayer(routeLine); routeLine=null; }
  markers.forEach(m=>map.removeLayer(m)); markers=[];
  points.forEach((p,idx)=>{ const m=L.marker([p.lat,p.lon]).addTo(map).bindPopup(idx===0?'Départ':(idx===points.length-1?'Arrivée':`Étape ${idx}`)); markers.push(m); });
  const coords = points.map(p=>`${p.lon},${p.lat}`).join(';');
  const params = new URLSearchParams({overview:'full',geometries:'geojson',steps:'false',alternatives:'false'});
  if(avoid) params.set('exclude', avoid);
  const url = `${OSRM}/route/v1/driving/${coords}?${params.toString()}`;
  const r = await fetch(url);
  if(!r.ok){ showToast('OSRM route indisponible'); return {distanceKm:0,durationMin:0}; }
  const d = await r.json();
  if(!d.routes || !d.routes.length){ showToast('Route introuvable'); return {distanceKm:0,durationMin:0}; }
  const route = d.routes[0];
  const latlngs = route.geometry.coordinates.map(([x,y])=>[y,x]);
  routeLine = L.polyline(latlngs,{weight:5,opacity:.95}).addTo(map);
  map.fitBounds(routeLine.getBounds(), {padding:[40,40]});
  return { distanceKm: Math.round(route.distance/10)/100, durationMin: Math.round(route.duration/60) };
}

// Navigation links
function buildNavLinks(points){
  const nav=document.getElementById('navActions'); const g=document.getElementById('navGmaps'); const a=document.getElementById('navApple'); const w=document.getElementById('navWaze');
  nav.style.display='flex';
  const enc=s=>encodeURIComponent(s);
  const origin = points[0].label || `${points[0].lat},${points[0].lon}`;
  const dest = points.at(-1).label || `${points.at(-1).lat},${points.at(-1).lon}`;
  const wps = points.slice(1,-1).map(p=> p.label || `${p.lat},${p.lon}`);
  g.href = `https://www.google.com/maps/dir/?api=1&origin=${enc(origin)}&destination=${enc(dest)}&travelmode=driving&waypoints=${enc(wps.join('|'))}`;
  a.href = `https://maps.apple.com/?saddr=${enc(origin)}&daddr=${enc((wps.concat([dest])).join(' to:'))}`;
  w.href = `https://waze.com/ul?ll=${points.at(-1).lat},${points.at(-1).lon}&navigate=yes`;
}

// Form submit
document.getElementById('tour-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const btn=document.getElementById('optimizeBtn'); const label=document.getElementById('optLabel');
  const originQ=document.getElementById('origin').value.trim();
  const destQ=document.getElementById('destination').value.trim();
  const avoid=document.getElementById('avoid').value;
  if(!originQ){ showToast('Saisir un départ'); return; }
  const inputs=Array.from(document.querySelectorAll('#stages input[type=text]'));
  const stagesQ = inputs.map(i=>i.value.trim()).filter(Boolean);
  btn.disabled=true; label.textContent='Calcul...';

  try{
    const origin = await geocodeOne(originQ);
    const stops = [];
    for(const s of stagesQ){ stops.push(await geocodeOne(s)); }
    let points=[];
    if(destQ){ const dest = await geocodeOne(destQ); points=[origin, ...stops, dest]; }
    else { points=[origin, ...stops, origin]; } // boucle

    // Single matrix call + optimize
    const M = await osrmTable(points);
    let order = nearestNeighborOrder(M, 0, points.length-1);
    order = twoOpt(order, M);
    const optimized = order.map(i=>points[i]);

    const { distanceKm, durationMin } = await drawRoute(optimized, avoid);
    document.getElementById('statOrder').textContent = 'Ordre: ' + optimized.map((p,i)=> (i===0?'Départ':(i===optimized.length-1?'Arrivée':`É${i}`))).join(' → ');
    document.getElementById('statDist').textContent = `Distance: ${distanceKm} km`;
    document.getElementById('statDur').textContent = `Durée: ${durationMin} min`;
    document.getElementById('summary').textContent = `${optimized[0].label.split(',')[0]} → ${optimized.at(-1).label.split(',')[0]} • ${distanceKm} km • ${durationMin} min`;

    buildNavLinks(optimized);
  }catch(err){
    console.error(err); showToast('Optimisation impossible (réseau/OSRM/adresses)');
  }finally{
    btn.disabled=false; label.textContent='🚀 Optimiser la tournée';
  }
});

document.getElementById('resetBtn').addEventListener('click', ()=>{
  stagesDiv.innerHTML=''; stageCount=0;
  if(routeLine){ map.removeLayer(routeLine); routeLine=null; }
  markers.forEach(m=>map.removeLayer(m)); markers=[];
  document.getElementById('statOrder').textContent='Ordre: -';
  document.getElementById('statDist').textContent='Distance: -';
  document.getElementById('statDur').textContent='Durée: -';
  document.getElementById('summary').textContent='';
  document.getElementById('navActions').style.display='none';
});
