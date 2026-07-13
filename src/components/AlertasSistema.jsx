import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, getDocs, getDoc, doc } from 'firebase/firestore';
import { db, dbEstoqueOS } from '../services/firebase';
import { useProdutos } from '../services/hooks';

const DIAS_JANELA_VALIDADE = 45;
const INTERVALO_REFRESH_MP_MS = 5 * 60 * 1000; // MP não é tempo real — evita ler a coleção de lotes toda hora

function diasAte(dataStr) {
  if (!dataStr) return null;
  const alvo = new Date(dataStr + (typeof dataStr === 'string' && dataStr.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(alvo.getTime())) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  alvo.setHours(0, 0, 0, 0);
  return Math.round((alvo - hoje) / 86400000);
}
function formatarDataBR(iso) {
  try {
    const d = new Date(iso + (typeof iso === 'string' && iso.length === 10 ? 'T00:00:00' : ''));
    return d.toLocaleDateString('pt-BR');
  } catch { return iso; }
}

// ── Hooks: Produto Acabado (tempo real, coleções já usadas em outras telas) ──
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
function useLotesFisicosPA() {
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

// ── Hook: Matéria Prima (sistema OS externo — Expedição) ──────────
// Não usa onSnapshot: batches pode ser uma coleção grande, então
// faz fetch periódico (a cada 5 min) em vez de tempo real.
function useEstoqueMP() {
  const [itensMP, setItensMP] = useState([]);
  const [ultimaBusca, setUltimaBusca] = useState(null);

  useEffect(() => {
    let ativo = true;
    async function buscar() {
      try {
        const winRef = await getDocs(collection(db, 'winthorEstoqueSistema'));
        const winthorData = {};
        winRef.forEach(d => { winthorData[d.id] = d.data().saldoWinthor || 0; });

        const cDoc = await getDoc(doc(dbEstoqueOS, 'global_settings', 'company_db'));
        if (!cDoc.exists() || !cDoc.data().masterUid) { if (ativo) setItensMP([]); return; }
        const mUid = cDoc.data().masterUid;

        const [invS, batS] = await Promise.all([
          getDocs(collection(dbEstoqueOS, 'users', mUid, 'inventory')),
          getDocs(collection(dbEstoqueOS, 'users', mUid, 'batches')),
        ]);

        const batMap = {};
        const lotesComValidade = [];
        batS.forEach(b => {
          const bd = b.data();
          const pid = bd.productId || bd.item_id;
          if (!batMap[pid]) batMap[pid] = [];
          if ((bd.quantity || 0) > 0) {
            batMap[pid].push({ id: b.id, ...bd });
            const validade = bd.expiryDate || bd.validade;
            if (validade) lotesComValidade.push({ id: b.id, productId: pid, validade, qtd: bd.quantity });
          }
        });

        const mpList = [];
        invS.forEach(d => {
          const inv = d.data();
          const totalFisico = (batMap[d.id] || []).reduce((acc, l) => acc + (parseFloat(l.quantity) || 0), 0);
          mpList.push({
            id: d.id,
            codigo: inv.code || d.id,
            nome: inv.name,
            und: inv.unit || 'kg',
            totalFisico,
            saldoWinthor: winthorData[inv.code || d.id] || 0,
          });
        });

        if (ativo) {
          setItensMP(mpList.map(m => ({ ...m, lotes: batMap[m.id] || [] })));
          setUltimaBusca(new Date().toISOString());
        }
      } catch (e) {
        console.error('Erro ao buscar MP para alertas:', e);
      }
    }
    buscar();
    const t = setInterval(buscar, INTERVALO_REFRESH_MP_MS);
    return () => { ativo = false; clearInterval(t); };
  }, []);

  return { itensMP, ultimaBusca };
}

export default function AlertasSistema() {
  const [aberto, setAberto] = useState(false);
  const { produtos } = useProdutos();
  const estoquePA = useEstoquePABridge();
  const lotesPA = useLotesFisicosPA();
  const { itensMP } = useEstoqueMP();

  // ── Alertas de cobertura 48h (gravados pela bridge via calcularAlertasEstoque) ──
  // Usa a média real do Winthor (consultarMediaMovi2). Cada doc em alertasEstoque
  // tem: { produto, estoqueAtual, cobertura48h, semCobertura48h, abaixoDoMinimo,
  //        mediaSaidaDiaria, rendimentoReal, horasAteMinimo, status }
  const [alertas48h, setAlertas48h] = useState([]);
  useEffect(() => {
    return onSnapshot(collection(db, 'alertasEstoque'), snap => {
      const lista = [];
      snap.forEach(d => {
        const dado = d.data();
        // Só mostra alertas ativos (não resolvidos)
        if (dado.status !== 'resolvido') lista.push({ id: d.id, ...dado });
      });
      // Ordena: abaixo do mínimo primeiro, depois por horas até o mínimo
      lista.sort((a, b) => {
        if (a.abaixoDoMinimo !== b.abaixoDoMinimo) return a.abaixoDoMinimo ? -1 : 1;
        return (a.horasAteMinimo || 0) - (b.horasAteMinimo || 0);
      });
      setAlertas48h(lista);
    });
  }, []);

  // ── Abaixo do mínimo: PA (Winthor) + MP (físico OS) ──
  const abaixoMinimo = useMemo(() => {
    const doPA = estoquePA
      .map(item => {
        const conf = produtos.find(p => p.nome === item.produto);
        const minimo = item.estoqueMinimo > 0 ? item.estoqueMinimo : (conf?.estoqueMinAcabado || 0);
        if (minimo <= 0 || item.estoqueAtual > minimo) return null;
        return { tipo: 'PA', nome: item.produto, codigo: item.codigo, atual: item.estoqueAtual, minimo, unidade: item.unidade, id: 'pa-' + item.id };
      })
      .filter(Boolean);

    const doMP = itensMP
      .map(item => {
        const conf = produtos.find(p => p.codigo === item.codigo || p.nome === item.nome);
        const minimo = conf?.estoqueMinMP || 0;
        if (minimo <= 0 || item.totalFisico > minimo) return null;
        return { tipo: 'MP', nome: item.nome, codigo: item.codigo, atual: item.totalFisico, minimo, unidade: item.und, id: 'mp-' + item.id };
      })
      .filter(Boolean);

    return [...doPA, ...doMP].sort((a, b) => (a.atual / (a.minimo || 1)) - (b.atual / (b.minimo || 1)));
  }, [estoquePA, itensMP, produtos]);

  // ── Validades: lotes PA + lotes MP ──
  const validades = useMemo(() => {
    const doPA = lotesPA
      .map(l => {
        const dias = diasAte(l.validade);
        if (dias == null || dias > DIAS_JANELA_VALIDADE) return null;
        return { tipo: 'PA', nome: l.nome, lote: l.lote, validade: l.validade, dias, id: 'pa-' + l.id };
      })
      .filter(Boolean);

    const doMP = [];
    itensMP.forEach(item => {
      (item.lotes || []).forEach(lt => {
        const validadeRaw = lt.expiryDate || lt.validade;
        const dias = diasAte(validadeRaw);
        if (dias == null || dias > DIAS_JANELA_VALIDADE) return;
        doMP.push({ tipo: 'MP', nome: item.nome, lote: lt.batchNumber || lt.code || lt.number || lt.id, validade: validadeRaw, dias, id: 'mp-' + lt.id });
      });
    });

    return [...doPA, ...doMP].sort((a, b) => a.dias - b.dias);
  }, [lotesPA, itensMP]);

  const totalAlertas = abaixoMinimo.length + validades.length + alertas48h.length;
  const temCritico = abaixoMinimo.some(a => a.atual <= 0) || validades.some(v => v.dias < 0) || alertas48h.some(a => a.abaixoDoMinimo);

  return (
    <>
      {/* ── Sino destacado ── */}
      <button
        onClick={() => setAberto(true)}
        style={{
          position: 'relative',
          background: totalAlertas > 0 ? '#fff1f2' : 'transparent',
          border: totalAlertas > 0 ? '2px solid #fda4af' : '2px solid transparent',
          borderRadius: 14,
          cursor: 'pointer',
          color: totalAlertas > 0 ? '#e11d48' : 'var(--marrom-claro)',
          fontSize: '1.7rem',
          width: 48,
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: totalAlertas > 0 ? 'sinoPulse 1.8s ease-in-out infinite' : 'none',
        }}
        title="Alertas do Sistema"
      >
        <i className="ph ph-bell" style={{ fontWeight: totalAlertas > 0 ? 900 : 400 }}></i>
        {totalAlertas > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6,
            background: temCritico ? '#dc2626' : '#e11d48',
            color: 'white', fontSize: '0.72rem', fontWeight: 900,
            borderRadius: 20, minWidth: 22, height: 22,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 5px', border: '2px solid white',
            boxShadow: '0 2px 6px rgba(220,38,38,0.5)',
          }}>
            {totalAlertas > 99 ? '99+' : totalAlertas}
          </span>
        )}
      </button>
      <style>{`
        @keyframes sinoPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(225,29,72,0.4); }
          50% { transform: scale(1.08); box-shadow: 0 0 0 8px rgba(225,29,72,0); }
        }
      `}</style>

      {aberto && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setAberto(false)}>
          <div style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 900, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--border-suave)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 900, fontSize: '1.15rem', color: 'var(--marrom)' }}>
                <i className="ph ph-bell" style={{ color: '#e11d48' }}></i> Alertas do Sistema
              </div>
              <button onClick={() => setAberto(false)} style={{ background: 'none', border: 'none', fontSize: '1.4rem', color: '#999', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, overflow: 'hidden', flex: 1 }}>

              {/* ── Coluna 1: Abaixo do mínimo (PA + MP) ── */}
              <div style={{ borderRight: '1px solid var(--border-suave)', overflowY: 'auto', padding: 16 }}>
                <div style={{ background: '#fef3e2', color: '#c2410c', fontWeight: 800, fontSize: '0.8rem', padding: '8px 14px', borderRadius: 8, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ph ph-warning"></i> ABAIXO DO MÍNIMO ({abaixoMinimo.length})
                </div>
                {abaixoMinimo.length === 0 && <div className="status-msg" style={{ padding: '20px 0' }}>Nenhum item abaixo do mínimo.</div>}
                {abaixoMinimo.map(item => (
                  <div key={item.id} style={{ borderLeft: '4px solid #e67e22', background: '#fafafa', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <i className={`ph ${item.tipo === 'MP' ? 'ph-truck' : 'ph-package'}`} style={{ color: item.tipo === 'MP' ? '#0284c7' : '#ca8a04', fontSize: '0.9rem' }}></i>
                      <span style={{ fontWeight: 800, color: 'var(--marrom)', fontSize: '0.9rem' }}>{item.nome}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <span style={{ fontSize: '0.72rem', color: '#999' }}>{item.codigo} · {item.tipo === 'MP' ? 'Matéria Prima' : 'Produto Acabado'}</span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 900, color: '#c2410c' }}>{item.atual} {item.unidade}</div>
                        <div style={{ fontSize: '0.68rem', color: '#999' }}>Mín: {item.minimo}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Coluna 2: Cobertura 48h (alertasEstoque — bridge com média real) ── */}
              <div style={{ borderRight: '1px solid var(--border-suave)', overflowY: 'auto', padding: 16 }}>
                <div style={{ background: '#f0f9ff', color: '#0369a1', fontWeight: 800, fontSize: '0.8rem', padding: '8px 14px', borderRadius: 8, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ph ph-clock-countdown"></i> COBERTURA 48H ({alertas48h.length})
                </div>
                {alertas48h.length === 0 && (
                  <div className="status-msg" style={{ padding: '20px 0' }}>
                    Todos os produtos cobrem as próximas 48h.
                  </div>
                )}
                {alertas48h.map(alerta => {
                  const critico = alerta.abaixoDoMinimo || (alerta.horasAteMinimo != null && alerta.horasAteMinimo < 24);
                  const cor = critico ? '#c0392b' : '#e67e22';
                  const bg  = critico ? '#fef2f2' : '#fff7ed';
                  return (
                    <div key={alerta.id} style={{ borderLeft: `4px solid ${cor}`, background: '#fafafa', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                      <div style={{ fontWeight: 800, color: 'var(--marrom)', fontSize: '0.88rem', marginBottom: 4 }}>
                        {alerta.produto}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                        <div style={{ fontSize: '0.7rem', color: '#999', lineHeight: 1.6 }}>
                          <div>Estoque: <strong>{alerta.estoqueAtual} {alerta.unidade}</strong></div>
                          {alerta.mediaSaidaDiaria > 0 && (
                            <div>Média/dia: <strong>{alerta.mediaSaidaDiaria.toFixed(1)} {alerta.unidade}</strong></div>
                          )}
                          {alerta.rendimentoReal > 0 && (
                            <div>Rendimento: <strong>{alerta.rendimentoReal} {alerta.unidade}/bat.</strong></div>
                          )}
                          {alerta.fonteMedia === 'winthor_media' && (
                            <div style={{ color: '#0369a1', fontSize: '0.65rem', marginTop: 2 }}>
                              <i className="ph ph-check" style={{ marginRight: 2 }}></i>Média real Winthor
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontWeight: 900, color: cor, fontSize: '1rem' }}>
                            {alerta.horasAteMinimo === Infinity || alerta.horasAteMinimo == null
                              ? '∞'
                              : `${alerta.horasAteMinimo.toFixed(0)}h`}
                          </div>
                          <div style={{ fontSize: '0.65rem', color: '#999' }}>até o mínimo</div>
                        </div>
                      </div>
                      {alerta.abaixoDoMinimo && (
                        <div style={{ marginTop: 6, background: '#fef2f2', color: '#c0392b', fontSize: '0.68rem', fontWeight: 800, padding: '3px 8px', borderRadius: 6, display: 'inline-block' }}>
                          ABAIXO DO MÍNIMO
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ── Coluna 3: Validades (PA + MP) ── */}
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <i className={`ph ${l.tipo === 'MP' ? 'ph-truck' : 'ph-package'}`} style={{ color: l.tipo === 'MP' ? '#0284c7' : '#ca8a04', fontSize: '0.85rem' }}></i>
                          <span style={{ fontWeight: 800, color: 'var(--marrom)', fontSize: '0.9rem' }}>{l.nome}</span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#999', marginTop: 2 }}>Lote: {l.lote || 'S/N'}</div>
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
