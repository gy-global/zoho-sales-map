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

  const stageColor = (stage) => {
    if (stage === 'Póliza Vendida') return '#10b981';
    if (stage === 'Perdidos')       return '#ef4444';
    if (stage === 'Baja')           return '#f59e0b';
    return '#6366f1';
  };

  const fianzaRows = (list) => list.map(f => `
    <div style="background:#f9f9f9;border-radius:6px;padding:8px 10px;margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:11px;color:#1a1a2e;font-weight:600;">${esc(f.deal_name)}</span>
        <span style="font-size:10px;background:${stageColor(f.stage)}22;color:${stageColor(f.stage)};padding:1px 6px;border-radius:10px;font-weight:600;white-space:nowrap;">${esc(f.stage)}</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
        <span style="font-size:10px;background:#e0e7ff;color:#3730a3;padding:1px 6px;border-radius:8px;">${esc(f.categoria_garantia ?? '—')}</span>
        <span style="font-size:10px;background:#f0fdf4;color:#166534;padding:1px 6px;border-radius:8px;">${esc(f.estado_contrato ?? '—')}</span>
        ${f.sucursal ? `<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:8px;">${esc(f.sucursal)}</span>` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="font-size:10px;color:#666;">Alquiler: <strong>${fmt(f.alquiler)}/mes</strong></span>
        <span style="font-size:10px;color:#666;">Garantía: <strong>${fmt(f.amount)}</strong></span>
      </div>
      ${fmtD(f.closing_date) ? `<div style="font-size:10px;color:#bbb;margin-top:2px;">Cierre: ${fmtD(f.closing_date)}</div>` : ''}
    </div>
  `).join('');

  const address = [inmo.billing_street, inmo.billing_city, inmo.billing_state].filter(Boolean).join(', ');

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;width:360px;padding:14px 16px;">
      <div style="background:#1a1a2e;padding:12px 14px;margin:-14px -16px 12px;border-radius:4px 4px 0 0;">
        <div style="color:white;font-size:14px;font-weight:700;margin-bottom:2px;padding-right:24px;">${esc(inmo.account_name)}</div>
        <div style="color:#94a3b8;font-size:11px;">${esc(address || '—')}</div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #f0f0f0;">
        <span style="font-size:10px;color:#999;text-transform:uppercase;font-weight:600;">Comercial</span>
        <span style="font-size:12px;color:#1a1a2e;font-weight:600;">${esc(inmo.comercial_garantiaya ?? '—')}</span>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:4px;">
        <div style="flex:1;background:#f0fdf4;border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:22px;font-weight:700;color:#10b981;">${inmo.total_polizas ?? 0}</div>
          <div style="font-size:10px;color:#666;margin-top:2px;">Pólizas</div>
        </div>
        <div style="flex:1;background:#fee2e2;border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:22px;font-weight:700;color:#ef4444;">${(inmo.total_deals ?? 0) - (inmo.total_polizas ?? 0)}</div>
          <div style="font-size:10px;color:#666;margin-top:2px;">Perdidos</div>
        </div>
        <div style="flex:1;background:#fef3c7;border-radius:8px;padding:10px;text-align:center;">
          <div style="font-size:13px;font-weight:700;color:#d97706;margin-top:4px;">${fmt(inmo.total_amount)}</div>
          <div style="font-size:10px;color:#666;margin-top:2px;">Recaudado</div>
        </div>
      </div>
      <div style="font-size:9px;color:#aaa;text-align:right;margin-bottom:12px;font-style:italic;">
        * Recaudado incluyen pólizas vendidas + renovaciones en estado "Renovado"
      </div>

      ${polizas.length > 0 ? `
      <div style="margin-top:10px;padding-top:10px;border-top:2px solid #d1fae5;">
        <div style="font-size:11px;color:#10b981;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px;">
          ✅ Pólizas vendidas — ${polizas.length}
        </div>
        ${fianzaRows(polizas)}
      </div>` : ''}

      ${otros.length > 0 ? `
      <div style="margin-top:10px;padding-top:10px;border-top:2px solid #e0e7ff;">
        <div style="font-size:11px;color:#6366f1;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px;">
          📋 Otros deals — ${otros.length}
        </div>
        ${fianzaRows(otros)}
      </div>` : ''}

      ${fianzas.length === 0 ? `
      <div style="text-align:center;padding:20px;color:#999;font-size:12px;">
        Sin deals asociados
      </div>` : ''}
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
    mapObj.current = L.map(mapRef.current, {
      center: [40.4168, -3.7038],
      zoom: 6,
      zoomControl: false,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CartoDB',
      maxZoom: 19,
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
      chunkedLoading: true,
      maxClusterRadius: 50,
      iconCreateFunction: (c) => {
        const count = c.getChildCount();
        const size  = count > 100 ? 44 : count > 50 ? 38 : count > 10 ? 32 : 28;
        return L.divIcon({
          html: `<div style="width:${size}px;height:${size}px;background:#6366f1;color:white;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.3);">${count > 999 ? '+999' : count}</div>`,
          className: '',
          iconSize: [size, size],
        });
      },
    });

    inmobiliarias.forEach(inmo => {
      if (!inmo.lat || !inmo.lng) return;

      const tienePolizas = (inmo.total_polizas ?? 0) > 0;
      const color        = tienePolizas ? '#6366f1' : '#94a3b8';
      const size         = tienePolizas ? 16 : 12;

      const icon = L.divIcon({
        html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([parseFloat(inmo.lat), parseFloat(inmo.lng)], { icon });

      marker.on('click', async () => {
        const fianzas = await fetchFianzas(inmo.zoho_id);
        marker.bindPopup(buildPopup(inmo, fianzas), { maxWidth: 400 }).openPopup();
      });

      cluster.addLayer(marker);
    });

    layerRef.current = cluster;
    mapObj.current.addLayer(cluster);
  }, [inmobiliarias]);

  return (
    <div style={{ position:'relative', width:'100%', height:'100%' }}>
      <div ref={mapRef} style={{ width:'100%', height:'100%' }} />
      <div style={{
        position:'absolute', bottom:'32px', right:'12px', zIndex:1000,
        background:'white', borderRadius:'12px',
        boxShadow:'0 2px 16px rgba(0,0,0,0.13)',
        minWidth:'210px', overflow:'hidden',
      }}>
        <button
          onClick={() => setShowPanel(!showPanel)}
          style={{ width:'100%', padding:'10px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', background:'none', border:'none', cursor:'pointer', borderBottom: showPanel ? '1px solid #f0f0f0' : 'none' }}
        >
          <span style={{ fontSize:'12px', fontWeight:700, color:'#1a1a2e' }}>🏢 {(stats?.total ?? 0).toLocaleString('es-ES')} inmobiliarias</span>
          <span style={{ fontSize:'12px', color:'#999' }}>{showPanel ? '▼' : '▲'}</span>
        </button>
        {showPanel && (
          <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:'10px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingBottom:'2px' }}>
              <span style={{ fontSize:'11px', color:'#999', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.4px' }}>Total recaudado</span>
              <span style={{ fontSize:'14px', color:'#6366f1', fontWeight:700 }}>€{(stats?.totalAmount ?? 0).toLocaleString('es-ES')}</span>
            </div>
            <div style={{ fontSize:'9px', color:'#aaa', fontStyle:'italic', paddingBottom:'10px', borderBottom:'1px solid #f0f0f0' }}>
              * Incluye pólizas vendidas + renovaciones en estado "Renovado"
            </div>
            <div style={{ fontWeight:600, fontSize:'11px', color:'#999', textTransform:'uppercase', letterSpacing:'0.5px' }}>Leyenda</div>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <span style={{ width:14, height:14, borderRadius:'50%', background:'#6366f1', display:'inline-block', border:'2px solid white', boxShadow:'0 0 0 1px #6366f1' }}/>
              <span style={{ fontSize:'12px', color:'#333' }}>Con pólizas vendidas</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <span style={{ width:10, height:10, borderRadius:'50%', background:'#94a3b8', display:'inline-block', border:'2px solid white', boxShadow:'0 0 0 1px #94a3b8' }}/>
              <span style={{ fontSize:'12px', color:'#333' }}>Sin pólizas vendidas</span>
            </div>
            <div style={{ fontWeight:600, fontSize:'11px', color:'#999', textTransform:'uppercase', letterSpacing:'0.5px', paddingTop:'10px', borderTop:'1px solid #f0f0f0' }}>Agrupación</div>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <span style={{ width:22, height:22, borderRadius:'50%', background:'#6366f1', display:'inline-flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:'9px', fontWeight:700, border:'2px solid white', flexShrink:0 }}>N</span>
              <span style={{ fontSize:'12px', color:'#333' }}>Haz zoom para expandir</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}