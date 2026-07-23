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
  'id', 'Deal_Name', 'Id_Garantia', 'Id_Garantia_auto', 'Categoria_de_Garantia',
  'num_fant', 'Contact_Name', 'Arrendatario_Principal', 'Arrendador',
  'Account_Name', 'Agente_Inmobiliario', 'Comercial_GarantiaYa',
  'Correo_Comercial', 'Analytics_Agente', 'Sucursal', 'Gestor_Riesgo', 'Owner',
  'Stage', 'Estado_del_Contrato', 'Renta_Activa', 'Resolucion_Riesgo',
  'Cotizacion', 'Documentacion', 'Comision', 'Tipo_de_Firma', 'Contratante',
  'Amount', 'Precio_Final', 'Alquiler', 'Alquiler_Total', 'Monto_Aprobado',
  'Tipo_de_Alquiler', 'Tipo_de_Duracion', 'Duracion_de_Contrato_Meses',
  'Closing_Date', 'Fecha_Inicio_de_Garantia', 'Fecha_Finalizacion_de_Garantia',
  'Fecha_Fase', 'Modified_Time', 'Direccion', 'Ciudad', 'Provincia',
  'Codigo_Postal', 'Direccion_Propiedad',
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
    .from('fianzas')
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
// Con ~30.000 fianzas totales, una recarga masiva o la primera corrida podría
// fácilmente superar los 2000 deals modificados y cortarse ahí sin este fix.
async function fetchModifiedDeals(token, since) {
  const results = {};
  let page      = 1;
  let pageToken = null;
  let hasMore   = true;
  const sinceStr = since.toUTCString();

  console.log(`📅 Trayendo deals modificados desde: ${sinceStr}`);

  while (hasMore) {
    const url = pageToken
      ? `https://www.zohoapis.eu/crm/v7/Deals?fields=${FIELDS}&per_page=200&page_token=${pageToken}`
      : `https://www.zohoapis.eu/crm/v7/Deals?fields=${FIELDS}&per_page=200&page=${page}`;
    try {
      const res  = await fetch(url, {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'If-Modified-Since': sinceStr,
        }
      });

      if (res.status === 304) { console.log('\n✅ Sin cambios desde el último sync'); break; }

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
    process.stdout.write(`\r📦 ${Object.keys(results).length} deals modificados...`);
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\n✅ ${Object.keys(results).length} deals modificados`);
  return Object.values(results);
}

function esCatastro(str) {
  if (!str) return false;
  const limpio = str.trim().replace(/\s/g, '');
  return /^[0-9]{7}[A-Z]{2}[0-9]{4}[A-Z][0-9]{4}[A-Z]{2}$/.test(limpio) ||
         /^[0-9A-Z]{14,20}$/.test(limpio);
}

function buildAddress(d) {
  const propiedad = d.Direccion_Propiedad?.trim();
  const direccion = d.Direccion?.trim();

  if (propiedad && !esCatastro(propiedad))
    return { address: `${propiedad}, España`, calidad: 'completa' };

  if (direccion && !esCatastro(direccion)) {
    const parts = [direccion, d.Ciudad, d.Provincia, d.Codigo_Postal].filter(Boolean);
    if (parts.length >= 2)
      return { address: `${parts.join(', ')}, España`, calidad: 'parcial' };
  }

  if (d.Ciudad || d.Provincia)
    return { address: [d.Ciudad, d.Provincia, 'España'].filter(Boolean).join(', '), calidad: 'ciudad' };

  return { address: null, calidad: 'sin_direccion' };
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

function mapDeal(d) {
  return {
    zoho_id:                     d.id,
    deal_name:                   d.Deal_Name,
    id_garantia:                 d.Id_Garantia,
    id_garantia_auto:            d.Id_Garantia_auto,
    categoria_garantia:          d.Categoria_de_Garantia,
    num_fant:                    d.num_fant,
    nombre_contacto:             d.Contact_Name?.name ?? null,
    arrendatario_principal:      d.Arrendatario_Principal?.name ?? null,
    arrendador:                  d.Arrendador?.name ?? null,
    nombre_inmobiliaria:         d.Account_Name?.name ?? null,
    inmobiliaria_zoho_id:        d.Account_Name?.id ?? null,
    agente_inmobiliario:         d.Agente_Inmobiliario?.name ?? null,
    comercial_garantiaya:        d.Comercial_GarantiaYa,
    correo_comercial:            d.Correo_Comercial,
    analytics_agente:            d.Analytics_Agente,
    sucursal:                    d.Sucursal,
    gestor_riesgo:               d.Gestor_Riesgo,
    owner:                       d.Owner?.name ?? null,
    stage:                       d.Stage,
    estado_contrato:             d.Estado_del_Contrato,
    renta_activa:                d.Renta_Activa ?? false,
    resolucion_riesgo:           d.Resolucion_Riesgo,
    cotizacion:                  d.Cotizacion,
    documentacion:               d.Documentacion,
    comision:                    d.Comision,
    tipo_firma:                  d.Tipo_de_Firma,
    contratante:                 d.Contratante,
    amount:                      d.Amount,
    precio_final:                d.Precio_Final,
    alquiler:                    d.Alquiler,
    alquiler_total:              d.Alquiler_Total,
    monto_aprobado:              d.Monto_Aprobado,
    tipo_alquiler:               d.Tipo_de_Alquiler,
    tipo_duracion:               d.Tipo_de_Duracion,
    duracion_contrato_meses:     d.Duracion_de_Contrato_Meses,
    closing_date:                d.Closing_Date ?? null,
    fecha_inicio_garantia:       d.Fecha_Inicio_de_Garantia ?? null,
    fecha_finalizacion_garantia: d.Fecha_Finalizacion_de_Garantia ?? null,
    fecha_fase:                  d.Fecha_Fase ?? null,
    direccion:                   d.Direccion,
    ciudad:                      d.Ciudad,
    provincia:                   d.Provincia,
    codigo_postal:               d.Codigo_Postal,
    direccion_completa:          d.Direccion_Propiedad,
    zoho_modified_time:          d.Modified_Time ?? null,
    synced_at:                   new Date().toISOString(),
  };
}

async function upsertBatch(rows) {
  const { error } = await supabase
    .from('fianzas')
    .upsert(rows, { onConflict: 'zoho_id', ignoreDuplicates: false });
  if (error) throw new Error(`Supabase upsert error: ${error.message}`);
}

async function geocodeNuevos(deals) {
  const zohoIds = deals.map(d => d.id);
  const { data: existentes } = await supabase
    .from('fianzas')
    .select('zoho_id, lat, direccion_completa')
    .in('zoho_id', zohoIds);

  const existMap = {};
  (existentes ?? []).forEach(r => { existMap[r.zoho_id] = r; });

  const pendientes = deals.filter(d => {
    if (d.Stage !== 'Póliza Vendida') return false;
    const actual = existMap[d.id];
    if (!actual) return true;
    if (!actual.lat) return true;
    const dirZoho = d.Direccion_Propiedad?.trim() ?? null;
    const dirSupa = actual.direccion_completa?.trim() ?? null;
    return dirZoho && dirZoho !== dirSupa;
  });

  if (pendientes.length === 0) return 0;
  console.log(`\n🗺️  Geocodificando ${pendientes.length} deals...`);

  let count = 0;
  for (const deal of pendientes) {
    const { address, calidad } = buildAddress(deal);
    if (!address) {
      await supabase.from('fianzas').update({ calidad_geocodificacion: 'sin_direccion' }).eq('zoho_id', deal.id);
      continue;
    }
    const { lat, lng } = await geocode(address);
    await supabase.from('fianzas').update({
      lat, lng,
      geocodificado:           lat !== null,
      calidad_geocodificacion: calidad,
      direccion_completa:      deal.Direccion_Propiedad ?? null,
    }).eq('zoho_id', deal.id);
    if (lat) count++;
  }
  return count;
}

async function main() {
  console.log('🚀 Iniciando sync incremental Deals → Supabase');
  const token = await getAccessToken();
  const since = await getLastSyncDate();
  const deals = await fetchModifiedDeals(token, since);

  if (deals.length === 0) {
    console.log('✅ No hay deals modificados desde el último sync');
    return;
  }

  const rows  = deals.map(mapDeal);
  const BATCH = 100;
  let saved   = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    await upsertBatch(rows.slice(i, i + BATCH));
    saved += Math.min(BATCH, rows.length - i);
    process.stdout.write(`\r💾 ${saved}/${rows.length} guardados...`);
  }
  console.log(`\n✅ ${saved} deals actualizados`);

  const geocoded = await geocodeNuevos(deals);
  if (geocoded > 0) console.log(`🗺️  ${geocoded} nuevas geocodificaciones`);

  const { count } = await supabase.from('fianzas').select('*', { count: 'exact', head: true });
  console.log(`📊 Total en Supabase: ${count}`);
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });