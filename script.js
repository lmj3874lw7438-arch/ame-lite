
// 100% frontend — geocoding (Nominatim) + haversine + AME pricing

// Map
const map = L.map('map', { zoomControl: false }).setView([46.6, 2.5], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
L.control.zoom({ position:'bottomright' }).addTo(map);
let markers = [], polyline = null;
function updateMap(a,b){
  markers.forEach(m => map.removeLayer(m));
  if (polyline) map.removeLayer(polyline);
  const m1 = L.marker([a.lat,a.lon]).addTo(map).bindPopup('Départ');
  const m2 = L.marker([b.lat,b.lon]).addTo(map).bindPopup('Arrivée');
  markers = [m1,m2];
  polyline = L.polyline([[a.lat,a.lon],[b.lat,b.lon]], { weight:4, opacity:.85 }).addTo(map);
  map.fitBounds(polyline.getBounds(), { padding:[40,40] });
}

// Helpers
function toRad(d){ return d*Math.PI/180; }
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}
async function geocode(q){
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers:{ 'Accept':'application/json' } });
  if (!res.ok) throw new Error('Géocodage indisponible');
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error('Adresse introuvable');
  const { lat, lon, display_name } = data[0];
  return { lat: parseFloat(lat), lon: parseFloat(lon), label: display_name };
}

function computePrice(distanceKm, poidsKg, manutention){
  const prixDistance = distanceKm * (1.50 + 0.15);
  const sup = poidsKg>1000 ? prixDistance*0.30 : (poidsKg>500 ? prixDistance*0.20 : (poidsKg>100 ? prixDistance*0.10 : 0));
  const manut = manutention ? 25 : 0;
  const total = prixDistance + sup + manut;
  return {
    totalHT: Math.round(total * 100) / 100,
    details: {
      distanceKm: distanceKm,
      prixDistance: Math.round(prixDistance * 100) / 100,
      poidsKg: poidsKg,
      surchargePoids: Math.round(sup * 100) / 100,
      manutention: manut
    }
  };
}

function parseKg(val){
  if (!val) return NaN;
  const x = String(val).replace(',', '.').replace(/[^0-9.]/g, '');
  return parseFloat(x);
}

// UI
const form = document.getElementById('quote-form');
const result = document.getElementById('result');
const trajet = document.getElementById('trajet');
const prix = document.getElementById('prix');
const breakdown = document.getElementById('breakdown');
const total = document.getElementById('total');
const summary = document.getElementById('summary');
const goBtn = document.getElementById('goBtn'); const goLabel = document.getElementById('goLabel');

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  result.style.display = 'none';
  breakdown.innerHTML = ''; prix.textContent = ''; total.textContent = ''; summary.textContent = '';

  const origin = document.getElementById('origin').value.trim();
  const destination = document.getElementById('destination').value.trim();
  const poids = parseKg(document.getElementById('poids').value);
  const manutention = document.getElementById('manutention').value === 'true';

  if (!origin || !destination || isNaN(poids) || poids <= 0) {
    alert('Merci de saisir une origine, une destination et un poids valide.');
    return;
  }

  goBtn.disabled = true; goLabel.innerHTML = '<span class="spinner"></span> Calcul...';

  try {
    const [o,d] = await Promise.all([geocode(origin), geocode(destination)]);
    updateMap(o,d);
    const dist = Math.round(haversine(o.lat,o.lon,d.lat,d.lon)*100)/100;
    summary.textContent = `Distance estimée: ${dist} km`;

    const devis = computePrice(dist, poids, manutention);
    trajet.textContent = `${o.label.split(',')[0]} → ${d.label.split(',')[0]}`;
    prix.textContent = `${devis.totalHT.toFixed(2)} € HT`;
    breakdown.innerHTML = `
      <div class="row"><span>${devis.details.distanceKm} km × (1,50 + 0,15)</span><span>${devis.details.prixDistance.toFixed(2)} €</span></div>
      <div class="row"><span>Supplément poids (${devis.details.poidsKg} kg)</span><span>${devis.details.surchargePoids.toFixed(2)} €</span></div>
      <div class="row"><span>Manutention</span><span>${(devis.details.manutention||0).toFixed(2)} €</span></div>
    `;
    total.textContent = `Total HT: ${devis.totalHT.toFixed(2)} €`;
    result.style.display = 'block';
  } catch (e1) {
    alert('Impossible de calculer le devis pour le moment.');
    console.error(e1);
  } finally {
    goBtn.disabled = false; goLabel.textContent = 'Obtenir mon devis AME';
  }
});
