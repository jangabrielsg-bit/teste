import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useProdutos } from '../services/hooks';

const DIAS_JANELA_VALIDADE = 45;

function diasAte(dataStr) {
  if (!dataStr) return null;
  const alvo = new Date(dataStr + (dataStr.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(alvo.getTime())) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  alvo.setHours(0, 0, 0, 0);
  return Math.round((alvo - hoje) / 86400000);
}
function formatarDataBR(iso) {
  try {
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    return d.toLocaleDateString('pt-BR');
  } catch { return iso; }
}

// ── Hooks leves — reaproveitam coleções já usadas em outras telas ──
function useEstoquePABridge() {
  const [itens, setItens] = useState([]);
  useEffect(() => {
    return onSnapshot(collection(db, 'estoquePA'), snap => {
      const lista = [];
      snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
      setItens(lista);
    });
  }, []);
  return itens;
}
function useLotesFisicos() {
  const [itens, setItens] = useState([]);
  useEffect(() => {
    return onSnapshot(collection(db, 'estoque'), snap => {
      const lista = [];
      snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
      setItens(lista);
    });
  }, []);
  return itens;
}

export default function AlertasSistema() {
  const [aberto, setAberto] = useState(false);
  const { produtos } = useProdutos();
  const estoquePA = useEstoquePABridge();
  const lotes = useLotesFisicos();

  // ── Abaixo do mínimo ──
  const abaixoMinimo = useMemo(() => {
    return estoquePA
      .map(item => {
        const conf = produtos.find(p => p.nome === item.produto);
        const minimo = item.estoqueMinimo > 0 ? item.estoqueMinimo : (conf?.estoqueMinAcabado || 0);
        if (minimo <= 0) return null;
        if (item.estoqueAtual > minimo) return null;
        return { ...item, minimo };
      })
      .filter(Boolean)
      .sort((a, b) => (a.estoqueAtual / (a.minimo || 1)) - (b.estoqueAtual / (b.minimo || 1)));
  }, [estoquePA, produtos]);

  // ── Validades próximas (inclui vencidos) ──
  const validades = useMemo(() => {
    return lotes
      .map(l => {
        const dias = diasAte(l.validade);
        if (dias == null || dias > DIAS_JANELA_VALIDADE) return null;
        return { ...l, dias };
      })
      .filter(Boolean)
      .sort((a, b) => a.dias - b.dias);
  }, [lotes]);

  const totalAlertas = abaixoMinimo.length + validades.length;

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--marrom-claro)', fontSize: '1.4rem', padding: 6 }}
        title="Alertas do Sistema"
      >
        <i className="ph ph-bell"></i>
        {totalAlertas > 0 && (
          <span style={{ position: 'absolute', top: 0, right: 0, background: '#e11d48', color: 'white', fontSize: '0.62rem', fontWeight: 900, borderRadius: 20, minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
            {totalAlertas > 99 ? '99+' : totalAlertas}
          </span>
        )}
      </button>

      {aberto && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setAberto(false)}>
          <div style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 900, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border-suave)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 900, fontSize: '1.15rem', color: 'var(--marrom)' }}>
                <i className="ph ph-bell" style={{ color: '#e11d48' }}></i> Alertas do Sistema
              </div>
              <button onClick={() => setAberto(false)} style={{ background: 'none', border: 'none', fontSize: '1.4rem', color: '#999', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, overflow: 'hidden', flex: 1 }}>

              {/* ── Coluna: Abaixo do mínimo ── */}
              <div style={{ borderRight: '1px solid var(--border-suave)', overflowY: 'auto', padding: 16 }}>
                <div style={{ background: '#fef3e2', color: '#c2410c', fontWeight: 800, fontSize: '0.8rem', padding: '8px 14px', borderRadius: 8, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ph ph-warning"></i> ABAIXO DO MÍNIMO ({abaixoMinimo.length})
                </div>
                {abaixoMinimo.length === 0 && <div className="status-msg" style={{ padding: '20px 0' }}>Nenhum item abaixo do mínimo.</div>}
                {abaixoMinimo.map(item => (
                  <div key={item.id} style={{ borderLeft: '4px solid #e67e22', background: '#fafafa', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <div style={{ fontWeight: 800, color: 'var(--marrom)', fontSize: '0.9rem' }}>{item.produto}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <span style={{ fontSize: '0.72rem', color: '#999' }}>{item.codigo}</span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 900, color: '#c2410c' }}>{item.estoqueAtual} {item.unidade}</div>
                        <div style={{ fontSize: '0.68rem', color: '#999' }}>Mín: {item.minimo}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Coluna: Validades ── */}
              <div style={{ overflowY: 'auto', padding: 16 }}>
                <div style={{ background: '#fde8e8', color: '#c0392b', fontWeight: 800, fontSize: '0.8rem', padding: '8px 14px', borderRadius: 8, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ph ph-clock"></i> VALIDADES (PRÓX. {DIAS_JANELA_VALIDADE} DIAS) ({validades.length})
                </div>
                {validades.length === 0 && <div className="status-msg" style={{ padding: '20px 0' }}>Nenhum lote próximo do vencimento.</div>}
                {validades.map((l, idx) => {
                  const vencido = l.dias < 0;
                  return (
                    <div key={l.id || idx} style={{ borderLeft: `4px solid ${vencido ? '#c0392b' : '#e67e22'}`, background: '#fafafa', borderRadius: 10, padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 800, color: 'var(--marrom)', fontSize: '0.9rem' }}>{l.nome}</div>
                        <div style={{ fontSize: '0.72rem', color: '#999' }}>Lote: {l.lote || 'S/N'}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 900, color: vencido ? '#c0392b' : '#e67e22' }}>{l.dias} dias</div>
                        <div style={{ fontSize: '0.68rem', color: '#999' }}>{formatarDataBR(l.validade)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
