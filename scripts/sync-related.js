// scripts/reconcile-related.js
//
// RECONCILIACIÓN COMPLETA de los 4 módulos relacionados con fianzas:
//   - Renovaciones          -> tabla renovaciones
//   - Impagos_Recuperos     -> tabla impagos_recupero
//   - Impagos_Notificaciones -> tabla impagos_notificaciones
//   - Impagos_Legales       -> tabla impagos_legales
//
// Reemplaza a sync-related.js (incremental) y a reconcile-impagos.js (parcial).
//
// Por cada módulo:
//   1. Trae TODOS los registros de Zoho (paginado por page_token, sin límite de 2000)
//   2. Upsert de todos en Supabase (onConflict: zoho_id)
//   3. Borra de Supabase los zoho_id que ya no existen en Zoho
//
// IMPORTANTE - orden en el cron: este script debe correr DESPUÉS de sync.js
// (fianzas), porque fianza_zoho_id es FK -> fianzas.zoho_id. Si una fianza
// referenciada todavía no existe en Supabase, el upsert de esa fila fallará
// con un error de foreign key (ahora sí visible, no se traga en silencio).

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Fetch COMPLETO de un módulo, paginado por page_token (sin límite de 2000 registros).
async function fetchAll(token, module, fields) {
  const results = [];
  let page = 1;
  let pageToken = null;
  let hasMore = true;

  while (hasMore) {
    const url = pageToken
      ? `https://www.zohoapis.eu/crm/v7/${module}?fields=${fields}&per_page=200&page_token=${pageToken}`
      : `https://www.zohoapis.eu/crm/v7/${module}?fields=${fields}&per_page=200&page=${page}`;

    const res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });

    if (res.status === 204) break;

    const text = await res.text();
    if (!text || text.trim() === '') break;

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error(`❌ ${module} página ${page}: respuesta no-JSON: ${text.slice(0, 300)}`);
      break;
    }

    if (data.code && data.code !== 'SUCCESS') {
      console.error(`❌ ${module} página ${page}: error Zoho -> ${JSON.stringify(data)}`);
      break;
    }

    if (!data.data || data.data.length === 0) break;

    results.push(...data.data);
    hasMore = data.info?.more_records ?? false;
    pageToken = data.info?.next_page_token ?? null;
    if (hasMore && !pageToken && page >= 10) {
      console.warn(`⚠️  ${module}: more_records=true pero sin next_page_token en la página ${page}. Deteniendo para evitar loop.`);
      break;
    }
    page++;
    await sleep(200);
  }

  console.log(`📦 ${module}: ${results.length} registros traídos de Zoho`);
  return results;
}

async function upsertBatched(table, rows, conflict = 'zoho_id') {
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(i, i + BATCH), { onConflict: conflict });
    if (error) throw new Error(`${table} upsert error: ${error.message}`);
  }
}

async function fetchExistingIds(table) {
  const ids = [];
  const PAGE = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('zoho_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} select error: ${error.message}`);
    if (!data || data.length === 0) break;
    ids.push(...data.map((d) => d.zoho_id));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return ids;
}

async function deleteBatched(table, ids) {
  const BATCH = 100;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const { error } = await supabase.from(table).delete().in('zoho_id', batch);
    if (error) throw new Error(`${table} delete error: ${error.message}`);
  }
}

async function reconcileModule({ table, zohoModule, fields, mapFn }) {
  const token = await getAccessToken();
  const zohoRows = await fetchAll(token, zohoModule, fields);

  if (zohoRows.length === 0) {
    console.warn(`⚠️  ${table}: 0 registros traídos de Zoho. Abortando borrado por seguridad.`);
    return;
  }

  const mapped = zohoRows.map(mapFn);
  const sinFianza = mapped.filter((r) => !r.fianza_zoho_id).length;
  if (sinFianza > 0) {
    console.log(`ℹ️  ${table}: ${sinFianza}/${mapped.length} registros sin fianza_zoho_id (quedan como null, no bloquean el upsert)`);
  }

  console.log(`⬆️  ${table}: upsert de ${mapped.length} registros...`);
  await upsertBatched(table, mapped, 'zoho_id');

  const zohoIds = new Set(mapped.map((r) => r.zoho_id));
  const existingIds = await fetchExistingIds(table);
  const toDelete = existingIds.filter((id) => !zohoIds.has(id));

  console.log(`🗑️  ${table}: ${toDelete.length} registros a eliminar (ya no existen en Zoho)`);
  if (toDelete.length > 0) {
    await deleteBatched(table, toDelete);
  }

  console.log(`✅ ${table}: reconciliación completa (${mapped.length} vivos, ${toDelete.length} borrados)`);
}

async function main() {
  console.log('🚀 Iniciando reconciliación COMPLETA: renovaciones + impagos (recupero, notificaciones, legales)');

  await reconcileModule({
    table: 'renovaciones',
    zohoModule: 'Renovaciones',
    fields: 'id,Name,Stage,Renovacion_N,Closing_Date,Amount,Estado_del_Contrato,Fianza,Modified_Time',
    mapFn: (r) => ({
      zoho_id:         r.id,
      fianza_zoho_id:  r.Fianza?.id ?? null,
      name:            r.Name,
      stage:           r.Stage,
      renovacion_n:    r.Renovacion_N,
      closing_date:    r.Closing_Date ?? null,
      amount:          r.Amount,
      estado_contrato: r.Estado_del_Contrato,
      synced_at:       new Date().toISOString(),
    }),
  });

  await reconcileModule({
    table: 'impagos_recupero',
    zohoModule: 'Impagos_Recuperos',
    fields: 'id,Name,Fase,Total_Reclamos,Saldo_Pendiente,Total_Pagado,Fianza,Modified_Time',
    mapFn: (r) => ({
      zoho_id:         r.id,
      fianza_zoho_id:  r.Fianza?.id ?? null,
      name:            r.Name,
      fase:            r.Fase,
      total_reclamos:  r.Total_Reclamos,
      saldo_pendiente: r.Saldo_Pendiente,
      total_pagado:    r.Total_Pagado,
      synced_at:       new Date().toISOString(),
    }),
  });

  await reconcileModule({
    table: 'impagos_notificaciones',
    zohoModule: 'Impagos_Notificaciones',
    fields: 'id,Name,Fase,Periodo_Mes,Periodo_A_o,Importe,Fianza,Modified_Time',
    mapFn: (n) => ({
      zoho_id:        n.id,
      fianza_zoho_id: n.Fianza?.id ?? null,
      name:           n.Name,
      fase:           n.Fase,
      periodo_mes:    n.Periodo_Mes,
      periodo_ano:    n.Periodo_A_o,
      importe:        n.Importe,
      synced_at:      new Date().toISOString(),
    }),
  });

  // OJO: a diferencia de los otros 3 módulos, aquí el campo lookup real es
  // "Fianzas" (plural) — confirmado con debug-lookup-fields.js.
  await reconcileModule({
    table: 'impagos_legales',
    zohoModule: 'Impagos_Legales',
    fields: 'id,Name,Fase_Legal,Caso_Activo,Saldo_Pendiente,Saldo_Recuperado,Fianzas,Modified_Time',
    mapFn: (l) => ({
      zoho_id:          l.id,
      fianza_zoho_id:   l.Fianzas?.id ?? null,
      name:             l.Name,
      fase_legal:       l.Fase_Legal,
      caso_activo:      l.Caso_Activo ?? false,
      saldo_pendiente:  l.Saldo_Pendiente,
      saldo_recuperado: l.Saldo_Recuperado,
      synced_at:        new Date().toISOString(),
    }),
  });

  console.log('🎉 Reconciliación completa de módulos relacionados terminada');
}

main().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});