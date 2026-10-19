import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';

const esc = (str) => (str ?? '—')
  .replace(/&/g, '&amp;').replace(/'/g, '&#39;')
  .replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmt = (n) => n ? `€${Number(n).toLocaleString('es-ES')}` : '—';

const fmtDate = (d) => {
  if (!d) return null;
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const faseColor = (fase) => {
  if (!fase) return { bg: '#f1f5f9', text: '#64748b' };
  const f = fase.toLowerCase();
  if (f.includes('pagado') || f.includes('cerrado') || f.includes('recuperado')) return { bg: '#dcfce7', text: '#15803d' };
  if (f.includes('legal') || f.includes('demanda') || f.includes('juicio'))      return { bg: '#fee2e2', text: '#dc2626' };
  if (f.includes('nuevo') || f.includes('pendiente') || f.includes('notif'))     return { bg: '#fef3c7', text: '#d97706' };
  if (f.includes('confirmacion') || f.includes('confirmación'))                   return { bg: '#dbeafe', text: '#1d4ed8' };
  if (f.includes('desestimado') || f.includes('improcedente'))                    return { bg: '#f1f5f9', text: '#64748b' };
  return { bg: '#ede9fe', text: '#6d28d9' };
};

function buildPopup(f) {
  const isVigente    = f.estado_contrato === 'VIGENTE';
  const tieneImpagos = (f.impagos_recupero?.length > 0) ||
                       (f.impagos_notificaciones?.length > 0) ||
                       (f.impagos_legales?.length > 0);

  const renovaciones   = f.renovaciones ?? [];
  const recuperos      = f.impagos_recupero ?? [];
  const notificaciones = f.impagos_notificaciones ?? [];
  const legales        = f.impagos_legales ?? [];

  const headerBg = tieneImpagos
    ? 'linear-gradient(135deg, #7f1d1d, #b91c1c)'
    : isVigente
    ? 'linear-gradient(135deg, #14532d, #166534)'
    : 'linear-gradient(135deg, #1e293b, #0f172a)';

  const estadoLabel = tieneImpagos ? '⚠️ Con impagos' : isVigente ? '✅ Vigente' : (f.estado_contrato ?? '—');
  const ubicacion   = f.direccion_completa ?? [f.ciudad, f.provincia].filter(Boolean).join(', ') ?? '—';

  // Tags
  const tags = [];
  if (renovaciones.length > 0)   tags.push(`<span style="background:rgba(255,255,255,0.18);color:white;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:600;border:1px solid rgba(255,255,255,0.25);">🔄 ${renovaciones.length} renov.</span>`);
  if (recuperos.length > 0)      tags.push(`<span style="background:rgba(255,255,255,0.18);color:white;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:600;border:1px solid rgba(255,255,255,0.25);">⚠️ ${recuperos.length} recup.</span>`);
  if (notificaciones.length > 0) tags.push(`<span style="background:rgba(255,255,255,0.18);color:white;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:600;border:1px solid rgba(255,255,255,0.25);">📋 ${notificaciones.length} notif.</span>`);
  if (legales.length > 0)        tags.push(`<span style="background:rgba(255,255,255,0.18);color:white;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:600;border:1px solid rgba(255,255,255,0.25);">⚖️ ${legales.length} legal${legales.length > 1 ? 'es' : ''}</span>`);

  // ── Sección renovaciones ──────────────────────────────────────────
  let secRenovaciones = '';
  if (renovaciones.length > 0) {
    const rows = renovaciones.map(r => `
      <div style="background:#f8faff;border:1px solid #e0e7ff;border-radius:12px;padding:11px 13px;margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:7px;">
          <span style="font-size:12px;color:#1e293b;font-weight:700;flex:1;padding-right:8px;line-height:1.3;">${esc(r.name)}</span>
          <span style="font-size:13px;color:#059669;font-weight:800;white-space:nowrap;">${fmt(r.amount)}</span>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;">
          <span style="font-size:10px;background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:20px;font-weight:600;">Nº ${esc(r.renovacion_n) === '—' ? '1' : esc(r.renovacion_n)}</span>
          <span style="font-size:10px;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:20px;font-weight:500;">${esc(r.stage)}</span>
          ${r.closing_date ? `<span style="font-size:10px;color:#64748b;background:#f1f5f9;padding:2px 8px;border-radius:20px;">📅 ${fmtDate(r.closing_date)}</span>` : ''}
        </div>
      </div>`).join('');
    secRenovaciones = `
      <div style="padding:0 14px 4px;">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;padding-top:14px;border-top:1px solid #f1f5f9;">
          <div style="width:3px;height:14px;background:#6366f1;border-radius:2px;flex-shrink:0;"></div>
          <span style="font-size:11px;color:#4338ca;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;">Renovaciones · ${renovaciones.length}</span>
        </div>${rows}</div>`;
  }

  // ── Sección recuperos ─────────────────────────────────────────────
  let secRecuperos = '';
  if (recuperos.length > 0) {
    const rows = recuperos.map(r => {
      const fc = faseColor(r.fase);
      return `
      <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:12px;padding:11px 13px;margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:12px;color:#1e293b;font-weight:700;flex:1;padding-right:8px;line-height:1.3;">${esc(r.name)}</span>
          <span style="font-size:10px;background:${fc.bg};color:${fc.text};padding:2px 8px;border-radius:20px;font-weight:600;white-space:nowrap;">${esc(r.fase)}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;">
          <div style="background:white;border:1px solid #fecaca;border-radius:8px;padding:6px;text-align:center;">
            <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Reclamado</div>
            <div style="font-size:11px;color:#ef4444;font-weight:800;">${fmt(r.total_reclamos)}</div>
          </div>
          <div style="background:white;border:1px solid #fde68a;border-radius:8px;padding:6px;text-align:center;">
            <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Pendiente</div>
            <div style="font-size:11px;color:#d97706;font-weight:800;">${fmt(r.saldo_pendiente)}</div>
          </div>
          <div style="background:white;border:1px solid #bbf7d0;border-radius:8px;padding:6px;text-align:center;">
            <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Pagado</div>
            <div style="font-size:11px;color:#059669;font-weight:800;">${fmt(r.total_pagado)}</div>
          </div>
        </div>
      </div>`}).join('');
    secRecuperos = `
      <div style="padding:0 14px 4px;">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;padding-top:14px;border-top:1px solid #f1f5f9;">
          <div style="width:3px;height:14px;background:#ef4444;border-radius:2px;flex-shrink:0;"></div>
          <span style="font-size:11px;color:#dc2626;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;">Recupero · ${recuperos.length} caso${recuperos.length > 1 ? 's' : ''}</span>
        </div>${rows}</div>`;
  }

  // ── Sección notificaciones ────────────────────────────────────────
  let secNotificaciones = '';
  if (notificaciones.length > 0) {
    const rows = notificaciones.map(n => {
      const fc = faseColor(n.fase);
      return `
      <div style="background:#fffdf0;border:1px solid #fde68a;border-radius:12px;padding:11px 13px;margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
          <span style="font-size:12px;color:#1e293b;font-weight:700;flex:1;padding-right:8px;line-height:1.3;">${esc(n.name)}</span>
          <span style="font-size:13px;color:#d97706;font-weight:800;white-space:nowrap;">${fmt(n.importe)}</span>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;">
          <span style="font-size:10px;background:${fc.bg};color:${fc.text};padding:2px 8px;border-radius:20px;font-weight:600;">${esc(n.fase)}</span>
          ${n.periodo_mes ? `<span style="font-size:10px;color:#64748b;background:#f1f5f9;padding:2px 8px;border-radius:20px;">📅 ${esc(n.periodo_mes)} ${esc(n.periodo_ano)}</span>` : ''}
        </div>
      </div>`}).join('');
    secNotificaciones = `
      <div style="padding:0 14px 4px;">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;padding-top:14px;border-top:1px solid #f1f5f9;">
          <div style="width:3px;height:14px;background:#f59e0b;border-radius:2px;flex-shrink:0;"></div>
          <span style="font-size:11px;color:#b45309;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;">Notificaciones · ${notificaciones.length}</span>
        </div>${rows}</div>`;
  }

  // ── Sección legales ───────────────────────────────────────────────
  let secLegales = '';
  if (legales.length > 0) {
    const rows = legales.map(l => `
      <div style="background:#fff5f5;border:1px solid #fca5a5;border-radius:12px;padding:11px 13px;margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
          <span style="font-size:12px;color:#1e293b;font-weight:700;flex:1;padding-right:8px;line-height:1.3;">${esc(l.name)}</span>
          <span style="font-size:10px;background:${l.caso_activo ? '#fee2e2' : '#dcfce7'};color:${l.caso_activo ? '#dc2626' : '#16a34a'};padding:2px 8px;border-radius:20px;font-weight:700;white-space:nowrap;">${l.caso_activo ? '🔴 Activo' : '✅ Cerrado'}</span>
        </div>
        <div style="margin-bottom:7px;">
          <span style="font-size:10px;background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:20px;font-weight:600;">${esc(l.fase_legal)}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
          <div style="background:white;border:1px solid #fecaca;border-radius:8px;padding:6px;text-align:center;">
            <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Pendiente</div>
            <div style="font-size:11px;color:#ef4444;font-weight:800;">${fmt(l.saldo_pendiente)}</div>
          </div>
          <div style="background:white;border:1px solid #bbf7d0;border-radius:8px;padding:6px;text-align:center;">
            <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Recuperado</div>
            <div style="font-size:11px;color:#059669;font-weight:800;">${fmt(l.saldo_recuperado)}</div>
          </div>
        </div>
      </div>`).join('');
    secLegales = `
      <div style="padding:0 14px 4px;">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;padding-top:14px;border-top:1px solid #f1f5f9;">
          <div style="width:3px;height:14px;background:#dc2626;border-radius:2px;flex-shrink:0;"></div>
          <span style="font-size:11px;color:#dc2626;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;">Legales · ${legales.length} caso${legales.length > 1 ? 's' : ''}</span>
        </div>${rows}</div>`;
  }

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;width:340px;overflow:hidden;">

      <!-- HEADER con gradiente -->
      <div style="background:${headerBg};padding:18px 16px 14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;">
          <div>
            <div style="font-size:18px;font-weight:800;color:white;letter-spacing:-0.5px;line-height:1.1;">${esc(f.deal_name)}</div>
            ${f.sucursal ? `<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:3px;font-weight:500;">${esc(f.sucursal)}</div>` : ''}
          </div>
          <span style="flex-shrink:0;background:rgba(255,255,255,0.18);color:white;font-size:11px;font-weight:700;padding:5px 11px;border-radius:20px;border:1px solid rgba(255,255,255,0.3);backdrop-filter:blur(4px);">${estadoLabel}</span>
        </div>
        <!-- Dirección -->
        <div style="display:flex;align-items:flex-start;gap:7px;background:rgba(0,0,0,0.2);border-radius:10px;padding:9px 11px;margin-bottom:${tags.length > 0 ? '10px' : '0'};">
          <span style="font-size:14px;flex-shrink:0;">📍</span>
          <span style="font-size:11px;color:rgba(255,255,255,0.9);line-height:1.5;font-weight:500;">${esc(ubicacion)}</span>
        </div>
        ${tags.length > 0 ? `<div style="display:flex;gap:5px;flex-wrap:wrap;">${tags.join('')}</div>` : ''}
      </div>

      <!-- GRID DE DATOS -->
      <div style="padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#f8fafc;border-bottom:1px solid #f1f5f9;">
        <div style="background:white;border-radius:12px;padding:11px 13px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.6px;margin-bottom:5px;">Inmobiliaria</div>
          <div style="font-size:12px;color:#1e293b;font-weight:700;line-height:1.3;">${esc(f.nombre_inmobiliaria)}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:11px 13px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.6px;margin-bottom:5px;">Comercial</div>
          <div style="font-size:12px;color:#1e293b;font-weight:700;line-height:1.3;">${esc(f.analytics_agente ?? f.comercial_garantiaya ?? '—')}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:11px 13px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.6px;margin-bottom:5px;">Garantía</div>
          <div style="font-size:16px;color:#1e293b;font-weight:800;">${fmt(f.amount)}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:11px 13px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.6px;margin-bottom:5px;">Alquiler/mes</div>
          <div style="font-size:16px;color:#1e293b;font-weight:800;">${fmt(f.alquiler)}</div>
        </div>
        ${fmtDate(f.closing_date) ? `
        <div style="background:white;border-radius:12px;padding:11px 13px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.6px;margin-bottom:5px;">Fecha cierre</div>
          <div style="font-size:13px;color:#1e293b;font-weight:700;">${fmtDate(f.closing_date)}</div>
        </div>` : ''}
        ${f.duracion_contrato_meses ? `
        <div style="background:white;border-radius:12px;padding:11px 13px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.6px;margin-bottom:5px;">Duración</div>
          <div style="font-size:13px;color:#1e293b;font-weight:700;">${esc(f.duracion_contrato_meses)} meses</div>
        </div>` : ''}
      </div>

      <!-- SECCIONES IMPAGOS/RENOVACIONES -->
      ${secRenovaciones || secRecuperos || secNotificaciones || secLegales ? `
      <div style="padding-bottom:10px;background:white;">
        ${secRenovaciones}${secRecuperos}${secNotificaciones}${secLegales}
      </div>` : ''}
    </div>
  `;
}

export default function Map({ fianzas, stats, filtersOpen }) {
  const mapRef   = useRef(null);
  const mapObj   = useRef(null);
  const layerRef = useRef(null);
  const zoomRef  = useRef(null);
  const [showPanel, setShowPanel] = useState(true);

  useEffect(() => {
    if (mapObj.current) return;
    mapObj.current = L.map(mapRef.current, { center: [40.4168, -3.7038], zoom: 6, zoomControl: false });
        L.tileLayer(`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${import.meta.env.VITE_CARTO_KEY}`, {
      attribution: '© OpenStreetMap © CartoDB', maxZoom: 19,
    }).addTo(mapObj.current);
    zoomRef.current = L.control.zoom({ position: 'topright' });
    zoomRef.current.addTo(mapObj.current);
  }, []);

  useEffect(() => {
    if (!mapObj.current || !zoomRef.current) return;
    zoomRef.current.remove();
    zoomRef.current = L.control.zoom({ position: 'topright' });
    zoomRef.current.addTo(mapObj.current);
  }, [filtersOpen]);

  useEffect(() => {
    if (!mapObj.current || !fianzas.length) return;
    if (layerRef.current) mapObj.current.removeLayer(layerRef.current);

    const cluster = L.markerClusterGroup({
      chunkedLoading: true, chunkInterval: 50, chunkDelay: 50, maxClusterRadius: 50,
      iconCreateFunction: (c) => {
        const n = c.getChildCount();
        const s = n > 100 ? 44 : n > 50 ? 38 : n > 10 ? 32 : 28;
        return L.divIcon({
          html: `<div style="width:${s}px;height:${s}px;background:#1e293b;color:white;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.3);">${n > 999 ? '+999' : n}</div>`,
          className: '', iconSize: [s, s],
        });
      },
    });

    fianzas.forEach(f => {
      if (!f.lat || !f.lng) return;
      const isVigente    = f.estado_contrato === 'VIGENTE';
      const tieneImpagos = (f.impagos_recupero?.length > 0) || (f.impagos_notificaciones?.length > 0) || (f.impagos_legales?.length > 0);
      const color = tieneImpagos ? '#ef4444' : isVigente ? '#10b981' : '#f59e0b';
      const icon  = L.divIcon({
        html: `<div style="width:14px;height:14px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
        className: '', iconSize: [14, 14], iconAnchor: [7, 7],
      });
      L.marker([parseFloat(f.lat), parseFloat(f.lng)], { icon })
        .bindPopup(buildPopup(f), { maxWidth: 360 })
        .addTo(cluster);
    });

    layerRef.current = cluster;
    mapObj.current.addLayer(cluster);
  }, [fianzas]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      <div style={{
        position: 'absolute', bottom: '32px', right: '12px', zIndex: 1000,
        background: 'white', borderRadius: '16px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
        minWidth: '220px', overflow: 'hidden',
        border: '1px solid #e2e8f0',
      }}>
        <button onClick={() => setShowPanel(!showPanel)} style={{
          width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: showPanel ? '1px solid #f1f5f9' : 'none',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>
            📊 {(stats?.total ?? 0).toLocaleString('es-ES')} pólizas
          </span>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>{showPanel ? '▼' : '▲'}</span>
        </button>

        {showPanel && (
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', borderRadius: '12px', padding: '10px 12px', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Total recaudado</div>
              <div style={{ fontSize: '17px', color: '#15803d', fontWeight: 800 }}>€{(stats?.totalAmount ?? 0).toLocaleString('es-ES')}</div>
            </div>

            <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Leyenda</div>
            {[
              { color: '#10b981', label: 'Vigente sin impagos' },
              { color: '#ef4444', label: 'Con impagos' },
              { color: '#f59e0b', label: 'Otro estado' },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: color, display: 'inline-block', border: '2px solid white', boxShadow: `0 0 0 1px ${color}`, flexShrink: 0 }} />
                <span style={{ fontSize: '12px', color: '#475569' }}>{label}</span>
              </div>
            ))}

            {stats?.sinUbicacion > 0 && (
              <div style={{ paddingTop: '8px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Sin ubicación</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#ef4444' }}>{stats.sinUbicacion.toLocaleString('es-ES')}</span>
              </div>
            )}

            <div style={{ paddingTop: '8px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#1e293b', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '9px', fontWeight: 700, flexShrink: 0 }}>N</span>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Zoom para expandir</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}