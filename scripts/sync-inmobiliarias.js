import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const ZOHO_CLIENT_ID       = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET   = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN   = process.env.ZOHO_REFRESH_TOKEN;
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_MAPS_KEY      = process.env.GOOGLE_MAPS_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const FIELDS = [
  'id', 'Account_Name', 'Raz_n_Social', 'NIF_CIF', 'Email', 'Email_Secundario',
  'Phone', 'Movil', 'Website', 'Comercial_GarantiaYa', 'Analytics_Agente',
  'Correo_Comercial', 'id_comercial', 'Comision', 'Comision_Renovacion',
  'Comision_Forma_de_Pago', 'Billing_Street', 'Billing_City', 'Billing_State',
  'Billing_Code', 'Billing_Country', 'Renta_Activa', 'Marca',
  'Acuerdo_de_Colaboracion_Firmado', 'Migrado', 'Modified_Time',
].join(',');

async function getAccessToken() {
  const res = await fetch('https://accounts.zoho.eu/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: ZOHO_REFRESH_TOKEN,
      client_id:     ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  console.log('✅ Token de Zoho obtenido');
  return data.access_token;
}

async function getLastSyncDate() {
  const { data } = await supabase
    .from('inmobiliarias')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1);
  if (data && data.length > 0) {
    const lastSync = new Date(data[0].synced_at);
    lastSync.setHours(lastSync.getHours() - 1);
    return lastSync;
  }
  return new Date('2020-01-01T00:00:00Z');
}

// FIX: paginación por page_token además de page= — Zoho corta la paginación por
// número de página en los primeros 2000 registros (DISCRETE_PAGINATION_LIMIT_EXCEEDED).
// Si algún día hay >2000 inmobiliarias modificadas desde el último sync (recarga masiva,
// primera corrida, etc.), con solo "page=" el script se cortaría ahí silenciosamente.
async function fetchModifiedInmobiliarias(token, since) {
  const results = {};
  let page      = 1;
  let pageToken = null;
  let hasMore   = true;
  const sinceStr = since.toUTCString();

  console.log(`📅 Trayendo inmobiliarias modificadas desde: ${sinceStr}`);

  while (hasMore) {
    const url = pageToken
      ? `https://www.zohoapis.eu/crm/v7/Accounts?fields=${FIELDS}&per_page=200&page_token=${pageToken}`
      : `https://www.zohoapis.eu/crm/v7/Accounts?fields=${FIELDS}&per_page=200&page=${page}`;
    try {
      const res  = await fetch(url, {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'If-Modified-Since': sinceStr,
        }
      });

      if (res.status === 304) { console.log('\n✅ Sin cambios'); break; }

      const text = await res.text();
      if (!text || text.trim() === '') break;
      const data = JSON.parse(text);

      if (data.code && data.code !== 'SUCCESS') {
        console.error(`\n❌ Error página ${page}: ${JSON.stringify(data)}`);
        break;
      }

      if (!data.data || data.data.length === 0) break;
      data.data.forEach(d => { results[d.id] = d; });
      hasMore = data.info?.more_records ?? false;
      pageToken = data.info?.next_page_token ?? null;
      if (hasMore && !pageToken && page >= 10) {
        console.warn(`\n⚠️  more_records=true pero sin next_page_token en la página ${page}. Deteniendo.`);
        break;
      }
      page++;
    } catch (e) {
      console.error(`\n❌ Error página ${page}:`, e.message);
      break;
    }
    process.stdout.write(`\r📦 ${Object.keys(results).length} inmobiliarias modificadas...`);
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\n✅ ${Object.keys(results).length} inmobiliarias modificadas`);
  return Object.values(results);
}

async function getDealsStats() {
  let all  = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data } = await supabase
      .from('fianzas')
      .select('inmobiliaria_zoho_id, amount, stage')
      .not('inmobiliaria_zoho_id', 'is', null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  const stats = {};
  all.forEach(d => {
    const id = d.inmobiliaria_zoho_id;
    if (!id) return;
    if (!stats[id]) stats[id] = { total_deals: 0, total_polizas: 0, total_amount: 0 };
    stats[id].total_deals++;
    if (d.stage === 'Póliza Vendida') {
      stats[id].total_polizas++;
      stats[id].total_amount += d.amount ?? 0;
    }
  });
  return stats;
}

function normalizarCP(code) {
  if (!code) return null;
  const limpio = String(code).trim().replace(/\D/g, ''); // solo dígitos
  if (!limpio) return null;
  return limpio.padStart(5, '0'); // ej. 8028 -> 08028
}

function buildAddress(d) {
  const street = d.Billing_Street?.trim();
  const city   = d.Billing_City?.trim();
  const state  = d.Billing_State?.trim();
  const code   = normalizarCP(d.Billing_Code);
  if (street && street.length > 5)
    return [street, code, city].filter(Boolean).join(', ');
  if (city || state)
    return [code, city, state].filter(Boolean).join(', ');
  return null;
}

async function geocode(address) {
  if (!address || !GOOGLE_MAPS_KEY) return { lat: null, lng: null };
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}` +
      `&components=country:ES` +           // restringe resultados a España
      `&key=${GOOGLE_MAPS_KEY}`
    );
    const data = await res.json();
    if (data.status !== 'OK' || !data.results.length) {
      return { lat: null, lng: null };
    }
    const resultado = data.results[0];
    // Verificación extra: el país del resultado debe ser España (ES).
    // Protege contra casos como "Calle México 25" resolviendo al país México.
    const paisComponente = resultado.address_components.find(
      c => c.types.includes('country')
    );
    if (!paisComponente || paisComponente.short_name !== 'ES') {
      console.log(`   ⚠️  Descartado (país devuelto: ${paisComponente?.short_name || '?'}) para: ${address}`);
      return { lat: null, lng: null };
    }
    const { lat, lng } = resultado.geometry.location;
    return { lat, lng };
  } catch {
    return { lat: null, lng: null };
  }
}

function mapInmobiliaria(d, stats) {
  const s = stats[d.id] ?? { total_deals: 0, total_polizas: 0, total_amount: 0 };
  return {
    zoho_id:              d.id,
    account_name:         d.Account_Name,
    razon_social:         d.Raz_n_Social ?? null,
    nif_cif:              d.NIF_CIF ?? null,
    email:                d.Email ?? null,
    email_secundario:     d.Email_Secundario ?? null,
    telefono:             d.Phone ?? null,
    movil:                d.Movil ?? null,
    website:              d.Website ?? null,
    comercial_garantiaya: d.Comercial_GarantiaYa ?? null,
    analytics_agente:     d.Analytics_Agente ?? null,
    correo_comercial:     d.Correo_Comercial ?? null,
    id_comercial:         d.id_comercial ?? null,
    comision:             String(d.Comision ?? ''),
    comision_renovacion:  String(d.Comision_Renovacion ?? ''),
    comision_forma_pago:  d.Comision_Forma_de_Pago ?? null,
    billing_street:       d.Billing_Street ?? null,
    billing_city:         d.Billing_City ?? null,
    billing_state:        d.Billing_State ?? null,
    billing_code:         d.Billing_Code ?? null,
    billing_country:      d.Billing_Country ?? null,
    renta_activa:         d.Renta_Activa ?? false,
    marca:                d.Marca ?? false,
    acuerdo_colaboracion: d.Acuerdo_de_Colaboracion_Firmado ?? false,
    migrado:              d.Migrado ?? false,
    total_deals:          s.total_deals,
    total_polizas:        s.total_polizas,
    total_amount:         s.total_amount,
    zoho_modified_time:   d.Modified_Time ?? null,
    synced_at:            new Date().toISOString(),
  };
}

async function upsertBatch(rows) {
  const { error } = await supabase
    .from('inmobiliarias')
    .upsert(rows, { onConflict: 'zoho_id' });
  if (error) throw new Error(`Supabase upsert error: ${error.message}`);
}

async function updateStats(stats) {
  let page = 0;
  let total = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data } = await supabase
      .from('inmobiliarias')
      .select('zoho_id')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    const rows = data.map(i => ({
      zoho_id:       i.zoho_id,
      total_deals:   stats[i.zoho_id]?.total_deals   ?? 0,
      total_polizas: stats[i.zoho_id]?.total_polizas ?? 0,
      total_amount:  stats[i.zoho_id]?.total_amount  ?? 0,
      synced_at:     new Date().toISOString(),
    }));
    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      await upsertBatch(rows.slice(i, i + BATCH));
    }
    total += data.length;
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return total;
}

async function main() {
  console.log('🚀 Iniciando sync incremental Inmobiliarias → Supabase');
  const token = await getAccessToken();
  const since = await getLastSyncDate();
  const inmobiliarias = await fetchModifiedInmobiliarias(token, since);
  console.log('📊 Calculando stats de deals...');
  const stats = await getDealsStats();
  if (inmobiliarias.length === 0) {
    console.log('✅ No hay inmobiliarias modificadas — actualizando solo stats...');
    const total = await updateStats(stats);
    console.log(`✅ Stats actualizadas para ${total} inmobiliarias`);
    return;
  }
  const zohoIds = inmobiliarias.map(d => d.id);
  const { data: yaGeocoded } = await supabase
    .from('inmobiliarias')
    .select('zoho_id, lat, billing_street, billing_city, billing_state, billing_code')
    .in('zoho_id', zohoIds)
    .not('lat', 'is', null);
  const geocodedMap = {};
  (yaGeocoded ?? []).forEach(r => { geocodedMap[r.zoho_id] = r; });
  let geocodedCount = 0;
  const rows        = [];
  for (const inmo of inmobiliarias) {
    const row      = mapInmobiliaria(inmo, stats);
    const address  = buildAddress(inmo);
    const existing = geocodedMap[inmo.id];
    const dirCambio = existing && address && (
      existing.billing_street?.trim() !== inmo.Billing_Street?.trim() ||
      existing.billing_city?.trim()   !== inmo.Billing_City?.trim() ||
      existing.billing_state?.trim()  !== inmo.Billing_State?.trim() ||
      normalizarCP(existing.billing_code) !== normalizarCP(inmo.Billing_Code)
    );
    const necesitaGeocode = address && (!existing?.lat || dirCambio);
    if (necesitaGeocode) {
      const { lat, lng } = await geocode(address);
      row.lat = lat; row.lng = lng;
      row.geocodificado           = lat !== null;
      row.calidad_geocodificacion = lat !== null ? 'completa' : 'sin_coordenadas';
      if (lat) geocodedCount++;
    } else if (existing?.lat) {
      row.lat = existing.lat;
      row.geocodificado           = true;
      row.calidad_geocodificacion = 'completa';
    } else {
      row.calidad_geocodificacion = address ? 'sin_coordenadas' : 'sin_direccion';
    }
    rows.push(row);
  }
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) await upsertBatch(rows.slice(i, i + BATCH));
  console.log(`✅ ${rows.length} inmobiliarias actualizadas, ${geocodedCount} geocodificaciones`);
  console.log('📊 Actualizando stats de todas las inmobiliarias...');
  const total = await updateStats(stats);
  console.log(`✅ Stats actualizadas para ${total} inmobiliarias`);
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });