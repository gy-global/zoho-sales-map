import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const ZOHO_CLIENT_ID       = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET   = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN   = process.env.ZOHO_REFRESH_TOKEN;
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
    .from('renovaciones')
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

// FIX 1: ya no se traga los errores en silencio (antes "catch { break; }" sin loguear
// nada — así fue como id_ticket_fianzas mal escrito pasó desapercibido tanto tiempo).
// FIX 2: paginación por page_token además de page= — evita cortarse en los 2000
// registros si algún módulo tiene muchos cambios de golpe.
async function fetchModified(token, module, fields, since) {
  const results = [];
  let page      = 1;
  let pageToken = null;
  let hasMore   = true;
  const sinceStr = since.toUTCString();

  while (hasMore) {
    const url = pageToken
      ? `https://www.zohoapis.eu/crm/v7/${module}?fields=${fields}&per_page=200&page_token=${pageToken}`
      : `https://www.zohoapis.eu/crm/v7/${module}?fields=${fields}&per_page=200&page=${page}`;
    try {
      const res  = await fetch(url, {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'If-Modified-Since': sinceStr,
        }
      });

      if (res.status === 304) break;

      const text = await res.text();
      if (!text || text.trim() === '') break;
      const data = JSON.parse(text);

      if (data.code && data.code !== 'SUCCESS') {
        console.error(`❌ ${module} página ${page}: error Zoho -> ${JSON.stringify(data)}`);
        break;
      }

      if (!data.data || data.data.length === 0) break;
      results.push(...data.data);
      hasMore = data.info?.more_records ?? false;
      pageToken = data.info?.next_page_token ?? null;
      if (hasMore && !pageToken && page >= 10) {
        console.warn(`⚠️  ${module}: more_records=true pero sin next_page_token en la página ${page}. Deteniendo.`);
        break;
      }
      page++;
    } catch (e) {
      console.error(`❌ ${module} página ${page}: excepción -> ${e.message}`);
      break;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  return results;
}

async function upsert(table, rows, conflict) {
  if (rows.length === 0) return;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(i, i + BATCH), { onConflict: conflict });
    if (error) throw new Error(`${table} upsert error: ${error.message}`);
  }
}

async function main() {
  console.log('🚀 Iniciando sync incremental módulos relacionados');
  const token = await getAccessToken();
  const since = await getLastSyncDate();
  console.log(`📅 Sincronizando cambios desde: ${since.toUTCString()}`);

  // Renovaciones
  // FIX: el campo lookup real hacia la fianza es "Fianza" (confirmado con
  // debug-lookup-fields.js), no "id_ticket_fianzas" (ese campo existe pero es
  // texto suelto, no el lookup — por eso siempre venía null).
  const rens = await fetchModified(token, 'Renovaciones',
    'id,Name,Stage,Renovacion_N,Closing_Date,Amount,Estado_del_Contrato,Fianza,Modified_Time', since);
  console.log(`🔄 ${rens.length} renovaciones modificadas`);
  const rensSinFianza = rens.filter(r => !r.Fianza?.id).length;
  if (rensSinFianza > 0) console.log(`ℹ️  ${rensSinFianza} renovaciones sin Fianza vinculada en Zoho (quedan con fianza_zoho_id = null)`);
  await upsert('renovaciones', rens.map(r => ({
    zoho_id:         r.id,
    fianza_zoho_id:  r.Fianza?.id ?? null,
    name:            r.Name,
    stage:           r.Stage,
    renovacion_n:    r.Renovacion_N,
    closing_date:    r.Closing_Date ?? null,
    amount:          r.Amount,
    estado_contrato: r.Estado_del_Contrato,
    synced_at:       new Date().toISOString(),
  })), 'zoho_id');

  // Recuperos
  const recs = await fetchModified(token, 'Impagos_Recuperos',
    'id,Name,Fase,Total_Reclamos,Saldo_Pendiente,Total_Pagado,Fianza,Modified_Time', since);
  console.log(`⚠️  ${recs.length} recuperos modificados`);
  await upsert('impagos_recupero', recs.map(r => ({
    zoho_id:         r.id,
    fianza_zoho_id:  r.Fianza?.id ?? null,
    name:            r.Name,
    fase:            r.Fase,
    total_reclamos:  r.Total_Reclamos,
    saldo_pendiente: r.Saldo_Pendiente,
    total_pagado:    r.Total_Pagado,
    synced_at:       new Date().toISOString(),
  })), 'zoho_id');

  // Notificaciones
  const nots = await fetchModified(token, 'Impagos_Notificaciones',
    'id,Name,Fase,Periodo_Mes,Periodo_A_o,Importe,Fianza,Modified_Time', since);
  console.log(`📋 ${nots.length} notificaciones modificadas`);
  await upsert('impagos_notificaciones', nots.map(n => ({
    zoho_id:        n.id,
    fianza_zoho_id: n.Fianza?.id ?? null,
    name:           n.Name,
    fase:           n.Fase,
    periodo_mes:    n.Periodo_Mes,
    periodo_ano:    n.Periodo_A_o,
    importe:        n.Importe,
    synced_at:      new Date().toISOString(),
  })), 'zoho_id');

  // Legales
  // OJO: "Fianza" aquí es el mismo patrón confirmado en los otros 3 módulos,
  // pero NO se verificó específicamente para Impagos_Legales con el diagnóstico.
  // Si fianza_zoho_id queda siempre null en impagos_legales, correr
  // debug-lookup-fields.js contra "Impagos_Legales" para confirmar el nombre real.
  const legs = await fetchModified(token, 'Impagos_Legales',
    'id,Name,Fase_Legal,Caso_Activo,Saldo_Pendiente,Saldo_Recuperado,Fianza,Modified_Time', since);
  console.log(`⚖️  ${legs.length} legales modificados`);
  await upsert('impagos_legales', legs.map(l => ({
    zoho_id:          l.id,
    fianza_zoho_id:   l.Fianza?.id ?? null,
    name:             l.Name,
    fase_legal:       l.Fase_Legal,
    caso_activo:      l.Caso_Activo ?? false,
    saldo_pendiente:  l.Saldo_Pendiente,
    saldo_recuperado: l.Saldo_Recuperado,
    synced_at:        new Date().toISOString(),
  })), 'zoho_id');

  console.log('✅ Sync incremental módulos relacionados completado');
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });