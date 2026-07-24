import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useInmobiliarias(filtros = {}) {
  const [inmobiliarias, setInmobiliarias] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // Paso 1: filtros de fianzas — obtener inmobiliaria_zoho_ids que cumplen
        let inmoIdsFromFianzas = null;

        const hayFiltrosFianzas = filtros.sucursal || filtros.fechaDesde ||
          filtros.fechaHasta || filtros.conImpagos || filtros.conRenovaciones ||
          filtros.conRecuperos || filtros.conNotificaciones || filtros.conLegales ||
          filtros.rangoGarantia;

        if (hayFiltrosFianzas) {
          let q = supabase
            .from('fianzas')
            .select('inmobiliaria_zoho_id')
            .not('inmobiliaria_zoho_id', 'is', null);

          if (filtros.sucursal)   q = q.eq('sucursal', filtros.sucursal);
          if (filtros.fechaDesde) q = q.gte('closing_date', filtros.fechaDesde);
          if (filtros.fechaHasta) q = q.lte('closing_date', filtros.fechaHasta);
          if (filtros.rangoGarantia?.min) q = q.gte('amount', filtros.rangoGarantia.min);
          if (filtros.rangoGarantia?.max) q = q.lte('amount', filtros.rangoGarantia.max);

          if (filtros.conRecuperos) {
            const { data: ids } = await supabase
              .from('impagos_recupero')
              .select('fianza_zoho_id');
            const fianzaIds = [...new Set((ids ?? []).map(d => d.fianza_zoho_id))];
            q = q.in('zoho_id', fianzaIds);
          }

          if (filtros.conNotificaciones) {
            const { data: ids } = await supabase
              .from('impagos_notificaciones')
              .select('fianza_zoho_id');
            const fianzaIds = [...new Set((ids ?? []).map(d => d.fianza_zoho_id))];
            q = q.in('zoho_id', fianzaIds);
          }

          if (filtros.conLegales) {
            const { data: ids } = await supabase
              .from('impagos_legales')
              .select('fianza_zoho_id');
            const fianzaIds = [...new Set((ids ?? []).map(d => d.fianza_zoho_id))];
            q = q.in('zoho_id', fianzaIds);
          }

          if (filtros.conRenovaciones) {
            const { data: ids } = await supabase
              .from('renovaciones')
              .select('fianza_zoho_id');
            const fianzaIds = [...new Set((ids ?? []).map(d => d.fianza_zoho_id))];
            q = q.in('zoho_id', fianzaIds);
          }

          const { data } = await q;
          inmoIdsFromFianzas = [...new Set((data ?? []).map(d => d.inmobiliaria_zoho_id))];
        }

        // Paso 2: traer inmobiliarias
        let allData = [];
        let page    = 0;
        const PAGE_SIZE = 1000;

        while (true) {
          let query = supabase
            .from('inmobiliarias')
            .select(`
              zoho_id, account_name, email, movil, website,
              comercial_garantiaya, analytics_agente,
              billing_street, billing_city, billing_state,
              comision, comision_renovacion,
              lat, lng, total_deals, total_polizas, total_amount,
              renta_activa, marca, acuerdo_colaboracion
            `)
            .not('lat', 'is', null)
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

          if (filtros.comercial) query = query.eq('comercial_garantiaya', filtros.comercial);
          if (filtros.conPolizas) query = query.gt('total_polizas', 0);
          if (filtros.sinVentas)  query = query.eq('total_polizas', 0);
          if (filtros.conDeals)   query = query.gt('total_deals', 0);
          if (filtros.marca)      query = query.eq('marca', true);
          if (filtros.acuerdo)    query = query.eq('acuerdo_colaboracion', true);

          if (inmoIdsFromFianzas !== null) {
            if (inmoIdsFromFianzas.length === 0) { allData = []; break; }
            query = query.in('zoho_id', inmoIdsFromFianzas);
          }

          const { data, error } = await query;
          if (error) throw error;
          if (!data || data.length === 0) break;
          allData = allData.concat(data);
          if (data.length < PAGE_SIZE) break;
          page++;
        }

        setInmobiliarias(allData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [JSON.stringify(filtros)]);

  return { inmobiliarias, loading, error };
}