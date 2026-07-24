import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';

function SearchSelect({ label, value, onChange, options, placeholder }) {
  const [search, setSearch] = useState('');
  const [open, setOpen]     = useState(false);
  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));
  const selected = value ?? '';

  return (
    <div style={{ position:'relative', marginBottom:'2px' }}>
      <label style={{ display:'block', fontSize:'11px', fontWeight:600, color:'#888', marginBottom:'4px', marginTop:'14px', textTransform:'uppercase', letterSpacing:'0.4px' }}>
        {label}
      </label>
      <div
        onClick={() => setOpen(!open)}
        style={{ width:'100%', padding:'7px 8px', borderRadius:'6px', border:`1px solid ${open ? '#6366f1' : '#ddd'}`, fontSize:'13px', background:'white', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}
      >
        <span style={{ color: selected ? '#222' : '#aaa', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'200px' }}>
          {selected || placeholder}
        </span>
        <span style={{ color:'#999', fontSize:'10px', flexShrink:0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ position:'absolute', zIndex:2000, top:'100%', left:0, right:0, background:'white', border:'1px solid #ddd', borderRadius:'6px', boxShadow:'0 4px 16px rgba(0,0,0,0.12)', maxHeight:'220px', overflow:'hidden', display:'flex', flexDirection:'column' }}>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            onClick={e => e.stopPropagation()}
            placeholder="Buscar..."
            style={{ padding:'8px 10px', border:'none', borderBottom:'1px solid #f0f0f0', fontSize:'12px', outline:'none' }}
          />
          <div style={{ overflowY:'auto', maxHeight:'170px' }}>
            <div
              onClick={() => { onChange(''); setSearch(''); setOpen(false); }}
              style={{ padding:'8px 10px', fontSize:'12px', color:'#999', cursor:'pointer', background: !selected ? '#f5f5f5' : 'white' }}
            >
              {placeholder} ({options.length})
            </div>
            {filtered.map(o => (
              <div
                key={o}
                onClick={() => { onChange(o); setSearch(''); setOpen(false); }}
                style={{ padding:'8px 10px', fontSize:'12px', color:'#222', cursor:'pointer', background: selected === o ? '#ede9fe' : 'white', fontWeight: selected === o ? 600 : 400 }}
              >
                {o}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding:'8px 10px', fontSize:'12px', color:'#aaa' }}>Sin resultados</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FiltersInmo({ filtros, onChange, onClose }) {
  const [opciones, setOpciones] = useState({ comerciales: [], sucursales: [] });

  useEffect(() => {
    async function fetchOpciones() {
      // Comerciales de inmobiliarias
      const { data: inmoData } = await supabase
        .from('inmobiliarias')
        .select('comercial_garantiaya')
        .not('lat', 'is', null);

      // Sucursales paginadas desde fianzas
      let allFianzas = [];
      let page = 0;
      while (true) {
        const { data } = await supabase
          .from('fianzas')
          .select('sucursal')
          .not('sucursal', 'is', null)
          .range(page * 1000, (page + 1) * 1000 - 1);
        if (!data || data.length === 0) break;
        allFianzas = allFianzas.concat(data);
        if (data.length < 1000) break;
        page++;
      }

      setOpciones({
        comerciales: [...new Set((inmoData ?? []).map(d => d.comercial_garantiaya).filter(Boolean))].sort(),
        sucursales:  [...new Set(allFianzas.map(d => d.sucursal).filter(Boolean))].sort(),
      });
    }
    fetchOpciones();
  }, []);

  const set = (key, value) => onChange({ ...filtros, [key]: value || undefined });
  const activeCount = Object.values(filtros).filter(Boolean).length;

  const style = {
    wrap:     { width:'280px', background:'white', padding:'16px', height:'100%', overflowY:'auto' },
    badge:    { display:'inline-block', marginLeft:'6px', background:'#e0e7ff', color:'#3730a3', borderRadius:'10px', padding:'1px 6px', fontSize:'10px', fontWeight:600 },
    btn:      { width:'100%', marginTop:'20px', padding:'9px', background:'#1a1a2e', color:'white', border:'none', borderRadius:'6px', cursor:'pointer', fontSize:'13px', fontWeight:600 },
    label:    { display:'block', fontSize:'11px', fontWeight:600, color:'#888', marginBottom:'4px', marginTop:'14px', textTransform:'uppercase', letterSpacing:'0.4px' },
    sel:      { width:'100%', padding:'7px 8px', borderRadius:'6px', border:'1px solid #ddd', fontSize:'13px', background:'white', cursor:'pointer' },
    section:  { marginTop:'16px', paddingTop:'14px', borderTop:'1px solid #f0f0f0' },
    title:    { fontSize:'11px', fontWeight:700, color:'#1a1a2e', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'8px' },
    checkRow: { display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px', cursor:'pointer' },
  };

  return (
    <div style={style.wrap}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'4px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
          <p style={{ fontWeight:700, fontSize:'14px', color:'#1a1a2e', margin:0 }}>Filtros</p>
          {activeCount > 0 && <span style={style.badge}>{activeCount}</span>}
        </div>
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'18px', color:'#999' }}>✕</button>
      </div>

      {/* Filtros de la inmobiliaria */}
      <SearchSelect
        label="Comercial GarantíaYa"
        value={filtros.comercial}
        onChange={v => set('comercial', v)}
        options={opciones.comerciales}
        placeholder="Todos los comerciales"
      />

      {/* Filtros basados en fianzas */}
      <div style={style.section}>
        <div style={style.title}>Filtros por fianzas</div>

        <SearchSelect
          label="Sucursal"
          value={filtros.sucursal}
          onChange={v => set('sucursal', v)}
          options={opciones.sucursales}
          placeholder="Todas las sucursales"
        />

        <label style={style.label}>Fecha cierre desde</label>
        <input
          type="date"
          style={style.sel}
          value={filtros.fechaDesde ?? ''}
          onChange={e => set('fechaDesde', e.target.value)}
        />

        <label style={style.label}>Fecha cierre hasta</label>
        <input
          type="date"
          style={style.sel}
          value={filtros.fechaHasta ?? ''}
          onChange={e => set('fechaHasta', e.target.value)}
        />
      </div>

      {/* Filtros por actividad */}
      <div style={style.section}>
        <div style={style.title}>Actividad de la inmobiliaria</div>

        <label style={style.checkRow}>
          <input type="checkbox" checked={!!filtros.conPolizas} onChange={e => set('conPolizas', e.target.checked ? 'true' : '')} />
          <span style={{ fontSize:'12px', color:'#333' }}>✅ Con pólizas vendidas</span>
        </label>
        <label style={style.checkRow}>
          <input type="checkbox" checked={!!filtros.sinVentas} onChange={e => set('sinVentas', e.target.checked ? 'true' : '')} />
          <span style={{ fontSize:'12px', color:'#333' }}>🚫 Sin ventas</span>
        </label>
        <label style={style.checkRow}>
          <input type="checkbox" checked={!!filtros.conDeals} onChange={e => set('conDeals', e.target.checked ? 'true' : '')} />
          <span style={{ fontSize:'12px', color:'#333' }}>📋 Con cualquier deal</span>
        </label>
        <label style={style.checkRow}>
          <input type="checkbox" checked={!!filtros.marca} onChange={e => set('marca', e.target.checked ? 'true' : '')} />
          <div>
            <span style={{ fontSize:'12px', color:'#333' }}>⭐ Marca</span>
            <span style={{ fontSize:'10px', color:'#999', display:'block' }}>Franquicias (RE/MAX, Century21...)</span>
          </div>
        </label>
        <label style={style.checkRow}>
          <input type="checkbox" checked={!!filtros.acuerdo} onChange={e => set('acuerdo', e.target.checked ? 'true' : '')} />
          <span style={{ fontSize:'12px', color:'#333' }}>🤝 Acuerdo de colaboración</span>
        </label>
      </div>

      {/* Filtros por impagos */}
      <div style={style.section}>
        <div style={style.title}>Impagos en sus fianzas</div>

        <label style={style.checkRow}>
          <input type="checkbox" checked={!!filtros.conRenovaciones} onChange={e => set('conRenovaciones', e.target.checked ? 'true' : '')} />
          <span style={{ fontSize:'12px', color:'#333' }}>🔄 Con renovaciones</span>
        </label>
        <label style={style.checkRow}>
          <input type="checkbox" checked={!!filtros.conRecuperos} onChange={e => set('conRecuperos', e.target.checked ? 'true' : '')} />
          <span style={{ fontSize:'12px', color:'#333' }}>⚠️ Con impagos recupero</span>
        </label>
        <label style={style.checkRow}>
          <input type="checkbox" checked={!!filtros.conNotificaciones} onChange={e => set('conNotificaciones', e.target.checked ? 'true' : '')} />
          <span style={{ fontSize:'12px', color:'#333' }}>📋 Con notificaciones impago</span>
        </label>
        <label style={style.checkRow}>
          <input type="checkbox" checked={!!filtros.conLegales} onChange={e => set('conLegales', e.target.checked ? 'true' : '')} />
          <span style={{ fontSize:'12px', color:'#333' }}>⚖️ Con impagos legales</span>
        </label>
      </div>

      <button style={style.btn} onClick={() => onChange({})}>Limpiar filtros</button>
    </div>
  );
}