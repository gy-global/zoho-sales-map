import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import { supabase } from '../lib/supabase';

const esc = (str) => (str ?? '—')
  .replace(/&/g, '&amp;').replace(/'/g, '&#39;')
  .replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmt  = (n) => n ? `€${Number(n).toLocaleString('es-ES')}` : '—';
const fmtD = (d) => { if (!d) return null; const [y,m,day] = d.split('-'); return `${day}/${m}/${y}`; };

async function fetchFianzas(inmobiliariaZohoId) {
  const { data } = await supabase
    .from('fianzas')
    .select('deal_name, stage, alquiler, amount, categoria_garantia, estado_contrato, closing_date, sucursal, direccion_completa, ciudad')
    .eq('inmobiliaria_zoho_id', inmobiliariaZohoId)
    .order('closing_date', { ascending: false })
    .limit(200);
  return data ?? [];
}

function buildPopup(inmo, fianzas) {
  const polizas = fianzas.filter(f => f.stage === 'Póliza Vendida');
  const otros   = fianzas.filter(f => f.stage !== 'Póliza Vendida');
  const perdidos = fianzas.filter(f => f.stage === 'Perdidos').length;

  const stageColor = (stage) => {
    if (stage === 'Póliza Vendida') return { bg: '#dcfce7', text: '#15803d' };
    if (stage === 'Perdidos')       return { bg: '#fee2e2', text: '#dc2626' };
    if (stage === 'Baja')           return { bg: '#fef3c7', text: '#d97706' };
    return { bg: '#ede9fe', text: '#6d28d9' };
  };

  const address = [inmo.billing_street, inmo.billing_city, inmo.billing_state].filter(Boolean).join(', ');
  const tienePolizas = (inmo.total_polizas ?? 0) > 0;

  const headerBg = tienePolizas
    ? 'linear-gradient(135deg, #312e81, #4338ca)'
    : 'linear-gradient(135deg, #1e293b, #334155)';

  const fianzaRows = (list) => list.map(f => {
    const sc = stageColor(f.stage);
    return `
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:11px 13px;margin-bottom:6px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
        <span style="font-size:12px;color:#1e293b;font-weight:700;">${esc(f.deal_name)}</span>
        <span style="font-size:10px;background:${sc.bg};color:${sc.text};padding:2px 8px;border-radius:20px;font-weight:600;white-space:nowrap;">${esc(f.stage)}</span>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:7px;">
        ${f.categoria_garantia ? `<span style="font-size:10px;background:#ede9fe;color:#5b21b6;padding:2px 7px;border-radius:20px;font-weight:500;">${esc(f.categoria_garantia)}</span>` : ''}
        ${f.estado_contrato ? `<span style="font-size:10px;background:#f0fdf4;color:#166534;padding:2px 7px;border-radius:20px;font-weight:500;">${esc(f.estado_contrato)}</span>` : ''}
        ${f.sucursal ? `<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:20px;font-weight:500;">${esc(f.sucursal)}</span>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
        <div style="background:#f8fafc;border-radius:8px;padding:5px 8px;">
          <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Alquiler/mes</div>
          <div style="font-size:12px;color:#1e293b;font-weight:700;">${fmt(f.alquiler)}</div>
        </div>
        <div style="background:#f8fafc;border-radius:8px;padding:5px 8px;">
          <div style="font-size:9px;color:#94a3b8;font-weight:700;text-transform:uppercase;margin-bottom:2px;">Garantía</div>
          <div style="font-size:12px;color:#1e293b;font-weight:700;">${fmt(f.amount)}</div>
        </div>
      </div>
      ${fmtD(f.closing_date) ? `<div style="font-size:10px;color:#94a3b8;margin-top:6px;">📅 Cierre: ${fmtD(f.closing_date)}</div>` : ''}
    </div>`}).join('');

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;width:340px;overflow:hidden;">

      <!-- HEADER -->
      <div style="background:${headerBg};padding:18px 16px 14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;">
          <div style="flex:1;">
            <div style="font-size:16px;font-weight:800;color:white;letter-spacing:-0.3px;line-height:1.2;padding-right:8px;">${esc(inmo.account_name)}</div>
            ${inmo.comercial_garantiaya ? `<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:3px;font-weight:500;">${esc(inmo.comercial_garantiaya)}</div>` : ''}
          </div>
          <span style="flex-shrink:0;background:rgba(255,255,255,0.18);color:white;font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;border:1px solid rgba(255,255,255,0.25);">${tienePolizas ? '🏢 Activa' : '⚫ Sin pólizas'}</span>
        </div>
        ${address ? `
        <div style="display:flex;align-items:flex-start;gap:7px;background:rgba(0,0,0,0.2);border-radius:10px;padding:8px 11px;">
          <span style="font-size:13px;flex-shrink:0;">📍</span>
          <span style="font-size:11px;color:rgba(255,255,255,0.85);line-height:1.4;font-weight:500;">${esc(address)}</span>
        </div>` : ''}
      </div>

      <!-- STATS -->
      <div style="padding:14px;background:#f8fafc;border-bottom:1px solid #f1f5f9;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
          <div style="background:white;border-radius:12px;padding:11px 8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.05);border:1px solid #e2e8f0;">
            <div style="font-size:22px;font-weight:800;color:#4f46e5;line-height:1;">${inmo.total_polizas ?? 0}</div>
            <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.4px;margin-top:4px;">Pólizas</div>
          </div>
          <div style="background:white;border-radius:12px;padding:11px 8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.05);border:1px solid #e2e8f0;">
            <div style="font-size:22px;font-weight:800;color:#ef4444;line-height:1;">${perdidos}</div>
            <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.4px;margin-top:4px;">Perdidos</div>
          </div>
          <div style="background:white;border-radius:12px;padding:11px 8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.05);border:1px solid #e2e8f0;">
            <div style="font-size:13px;font-weight:800;color:#059669;line-height:1;margin-top:4px;">${fmt(inmo.total_amount)}</div>
            <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.4px;margin-top:4px;">Recaudado</div>
          </div>
        </div>
      </div>

      <!-- PÓLIZAS VENDIDAS -->
      ${polizas.length > 0 ? `
      <div style="padding:0 14px 4px;background:white;">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;padding-top:14px;border-top:1px solid #f1f5f9;">
          <div style="width:3px;height:14px;background:#4f46e5;border-radius:2px;flex-shrink:0;"></div>
          <span style="font-size:11px;color:#4338ca;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;">Pólizas vendidas · ${polizas.length}</span>
        </div>
        ${fianzaRows(polizas)}
      </div>` : ''}

      <!-- OTROS DEALS -->
      ${otros.length > 0 ? `
      <div style="padding:0 14px 4px;background:white;">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;padding-top:14px;border-top:1px solid #f1f5f9;">
          <div style="width:3px;height:14px;background:#94a3b8;border-radius:2px;flex-shrink:0;"></div>
          <span style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;">Otros deals · ${otros.length}</span>
        </div>
        ${fianzaRows(otros)}
      </div>` : ''}

      ${fianzas.length === 0 ? `
      <div style="text-align:center;padding:24px 16px;background:white;">
        <div style="font-size:28px;margin-bottom:8px;">🏢</div>
        <div style="font-size:12px;color:#94a3b8;font-weight:500;">Sin deals asociados</div>
      </div>` : '<div style="height:10px;background:white;"></div>'}
    </div>
  `;
}

export default function MapInmobiliarias({ inmobiliarias, stats, filtersOpen }) {
  const mapRef   = useRef(null);
  const mapObj   = useRef(null);
  const layerRef = useRef(null);
  const zoomRef  = useRef(null);
  const [showPanel, setShowPanel] = useState(true);

  useEffect(() => {
    if (mapObj.current) return;
    mapObj.current = L.map(mapRef.current, { center: [40.4168, -3.7038], zoom: 6, zoomControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
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
    if (!mapObj.current || !inmobiliarias.length) return;
    if (layerRef.current) mapObj.current.removeLayer(layerRef.current);

    const cluster = L.markerClusterGroup({
      chunkedLoading: true, maxClusterRadius: 50,
      iconCreateFunction: (c) => {
        const n = c.getChildCount();
        const s = n > 100 ? 44 : n > 50 ? 38 : n > 10 ? 32 : 28;
        return L.divIcon({
          html: `<div style="width:${s}px;height:${s}px;background:#4f46e5;color:white;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.3);">${n > 999 ? '+999' : n}</div>`,
          className: '', iconSize: [s, s],
        });
      },
    });

    inmobiliarias.forEach(inmo => {
      if (!inmo.lat || !inmo.lng) return;
      const tienePolizas = (inmo.total_polizas ?? 0) > 0;
      const color = tienePolizas ? '#4f46e5' : '#94a3b8';
      const size  = tienePolizas ? 16 : 12;

      const icon = L.divIcon({
        html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
        className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([parseFloat(inmo.lat), parseFloat(inmo.lng)], { icon });
      marker.on('click', async () => {
        const fianzas = await fetchFianzas(inmo.zoho_id);
        marker.bindPopup(buildPopup(inmo, fianzas), { maxWidth: 360 }).openPopup();
      });
      cluster.addLayer(marker);
    });

    layerRef.current = cluster;
    mapObj.current.addLayer(cluster);
  }, [inmobiliarias]);

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
            🏢 {(stats?.total ?? 0).toLocaleString('es-ES')} inmobiliarias
          </span>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>{showPanel ? '▼' : '▲'}</span>
        </button>

        {showPanel && (
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)', borderRadius: '12px', padding: '10px 12px', border: '1px solid #c7d2fe' }}>
              <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Total recaudado</div>
              <div style={{ fontSize: '17px', color: '#4338ca', fontWeight: 800 }}>€{(stats?.totalAmount ?? 0).toLocaleString('es-ES')}</div>
            </div>

            <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Leyenda</div>
            {[
              { color: '#4f46e5', size: 14, label: 'Con pólizas vendidas' },
              { color: '#94a3b8', size: 10, label: 'Sin pólizas vendidas' },
            ].map(({ color, size, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', border: '2px solid white', boxShadow: `0 0 0 1px ${color}`, flexShrink: 0 }} />
                <span style={{ fontSize: '12px', color: '#475569' }}>{label}</span>
              </div>
            ))}

            <div style={{ paddingTop: '8px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#4f46e5', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '9px', fontWeight: 700, flexShrink: 0 }}>N</span>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Zoom para expandir</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}