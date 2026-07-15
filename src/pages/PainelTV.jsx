import { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db, dbEstoqueOS } from '../services/firebase';
import { hojeISO, formatarDataBR } from '../services/utils';

// ── Hook: Estoque MP — polling a cada 30min (era 5min) ────────────
function useEstoqueMP(ativo) {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;

    async function buscar() {
      try {
        const cDoc = await getDoc(doc(dbEstoqueOS, 'global_settings', 'company_db'));
        if (!cDoc.exists() || !cDoc.data().masterUid) return;
        const mUid = cDoc.data().masterUid;

        // Lê inventory e batches em paralelo (2 getDocs em vez de onSnapshot)
        const [invSnap, batSnap] = await Promise.all([
          import('firebase/firestore').then(({ getDocs, collection }) =>
            getDocs(collection(dbEstoqueOS, 'users', mUid, 'inventory'))),
          import('firebase/firestore').then(({ getDocs, collection }) =>
            getDocs(collection(dbEstoqueOS, 'users', mUid, 'batches'))),
        ]);

        const saldos = {};
        batSnap.forEach(b => {
          const d = b.data();
          const pid = d.productId || d.item_id;
          if (pid) saldos[pid] = (saldos[pid] || 0) + (parseFloat(d.quantity) || 0);
        });

        const lista = [];
        invSnap.forEach(d => {
          const inv = d.data();
          lista.push({
            id: d.id,
            nome: inv.name || d.id,
            unidade: inv.unit || 'kg',
            saldo: saldos[d.id] || 0,
            minimo: inv.minimumQuantity || inv.minimumStock || inv.min_quantity || 0,
          });
        });

        lista.sort((a, b) => {
          const ca = a.minimo > 0 && a.saldo <= a.minimo ? 0 : 1;
          const cb = b.minimo > 0 && b.saldo <= b.minimo ? 0 : 1;
          if (ca !== cb) return ca - cb;
          return a.nome.localeCompare(b.nome, 'pt-BR');
        });

        if (vivo) { setItens(lista); setCarregando(false); }
      } catch (e) {
        console.error('MP para PainelTV:', e);
        if (vivo) setCarregando(false);
      }
    }

    buscar();
    // ✅ Polling a cada 30min (era 5min = 6× menos leituras)
    const t = setInterval(buscar, 30 * 60 * 1000);
    return () => { vivo = false; clearInterval(t); };
  }, [ativo]);

  return { itens, carregando };
}

const ABAS = ['producao', 'masseira', 'estoque_pa', 'estoque_mp'];
const NOMES_ABAS = { producao: 'Visão Geral', masseira: 'Masseira', estoque_pa: 'Est. PA', estoque_mp: 'Est. MP' };

export default function PainelTV({ sair }) {
  const dataHoje = hojeISO();
  const [aba, setAba]               = useState('producao');
  const [autoRodizio, setAutoRodizio] = useState(false);
  const [agora, setAgora]           = useState(new Date());
  const [itens, setItens]           = useState([]);
  const [existe, setExiste]         = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [tunelRegistros, setTunelRegistros] = useState([]);
  const [estoquePA, setEstoquePA]   = useState([]);

  // Relógio
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ✅ Produção do dia — onSnapshot num único doc (necessário: tempo real)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'producaoDiaria', dataHoje), snap => {
      setCarregando(false);
      if (snap.exists()) {
        setExiste(true);
        setItens(snap.data().itens || []);
        setTunelRegistros(snap.data().tunelRegistros || []);
      } else {
        setExiste(false); setItens([]); setTunelRegistros([]);
      }
    });
    return unsub;
  }, [dataHoje]);

  // ✅ Estoque PA — escuta doc RESUMO único em vez da coleção inteira
  // A bridge grava estoquePA_resumo/atual com a lista completa
  // → 1 leitura por sync em vez de N leituras (uma por produto)
  useEffect(() => {
    if (aba !== 'estoque_pa') return;
    const unsub = onSnapshot(doc(db, 'estoquePA_resumo', 'atual'), snap => {
      if (snap.exists()) {
        const lista = snap.data().itens || [];
        lista.sort((a, b) => {
          const ca = a.estoqueMinimo > 0 && a.estoqueAtual <= a.estoqueMinimo ? 0 : 1;
          const cb = b.estoqueMinimo > 0 && b.estoqueAtual <= b.estoqueMinimo ? 0 : 1;
          if (ca !== cb) return ca - cb;
          return (a.produto || '').localeCompare(b.produto || '', 'pt-BR');
        });
        setEstoquePA(lista);
      }
    });
    return unsub;
  }, [aba]);

  // Estoque MP
  const { itens: estoqueMP, carregando: carregandoMP } = useEstoqueMP(aba === 'estoque_mp');

  // Rodízio automático
  useEffect(() => {
    if (!autoRodizio) return;
    const t = setInterval(() => {
      setAba(prev => ABAS[(ABAS.indexOf(prev) + 1) % ABAS.length]);
    }, 30000);
    return () => clearInterval(t);
  }, [autoRodizio]);

  function alternarTelaCheia() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  function tempoDecorrido(iso) {
    if (!iso) return '—:—';
    const seg = Math.max(0, Math.floor((agora.getTime() - new Date(iso).getTime()) / 1000));
    return `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`;
  }

  function velItem(item) {
    const b = item.batidas || [];
    if (b.length < 2) return null;
    return (new Date(b.at(-1)).getTime() - new Date(b[0]).getTime()) / 60000 / (b.length - 1);
  }

  const totalProgramado = itens.reduce((s, it) => s + (it.metaLotes || 0), 0);
  const totalFeito      = itens.reduce((s, it) => s + (it.feitos || 0), 0);
  const pctGeral        = totalProgramado > 0 ? Math.round(totalFeito / totalProgramado * 100) : 0;
  const ordenados       = [...itens].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  const itemAtivo       = ordenados.find(it => it.feitos < it.metaLotes) || null;

  const todasBatidas      = itens.flatMap(it => it.batidas || []).sort();
  const ultimaBatidaGeral = todasBatidas.at(-1) || null;
  const velocidadeGeral   = (() => {
    if (todasBatidas.length < 2) return null;
    const min = (new Date(todasBatidas.at(-1)).getTime() - new Date(todasBatidas[0]).getTime()) / 60000;
    return min > 0 ? (todasBatidas.length - 1) / min : null;
  })();

  const porCategoria = {};
  ordenados.forEach(it => {
    const cat = it.categoria || 'Sem setor';
    if (!porCategoria[cat]) porCategoria[cat] = [];
    porCategoria[cat].push(it);
  });

  const S = {
    shell:   { display: 'flex', flexDirection: 'column', height: '100vh', background: '#3D2515', color: '#D0B29E', fontFamily: "'Inter', sans-serif", overflow: 'hidden' },
    header:  { height: 64, background: '#2A170A', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: '1px solid #5C3A21', flexShrink: 0, gap: 12 },
    main:    { flex: 1, padding: '20px 24px', overflowY: 'auto' },
    card:    { background: '#4A2E1A', borderRadius: 16, padding: 20, border: '1px solid #734A2A' },
    cardDark:{ background: '#2A170A', borderRadius: 14, padding: '14px 18px', border: '1px solid #5C3A21' },
    label:   { fontSize: '0.68rem', fontWeight: 800, color: '#D0B29E', textTransform: 'uppercase', letterSpacing: '0.07em' },
    h3:      { fontSize: '1.3rem', fontWeight: 700, textAlign: 'center', color: 'white', marginBottom: 20 },
  };

  return (
    <div style={S.shell}>

      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <img src={import.meta.env.BASE_URL + 'logo.png'} alt="IMAC" style={{ height: 36 }} />
          <span style={{ fontSize: '1.1rem', fontWeight: 900, color: '#F6BE00', letterSpacing: 2, textTransform: 'uppercase' }}>Painel Industrial</span>
        </div>

        <div style={{ display: 'flex', background: '#3D2515', padding: 3, borderRadius: 8, border: '1px solid #734A2A', gap: 3 }}>
          {ABAS.map(a => (
            <button key={a} onClick={() => { setAba(a); setAutoRodizio(false); }} style={{
              padding: '7px 14px', borderRadius: 5, fontWeight: 700, fontSize: '0.82rem',
              border: 'none', cursor: 'pointer',
              background: aba === a ? '#F6BE00' : 'transparent',
              color: aba === a ? '#2A170A' : '#D0B29E',
              transition: 'all 0.15s',
            }}>{NOMES_ABAS[a]}</button>
          ))}
          <button onClick={() => setAutoRodizio(v => !v)} style={{
            padding: '7px 14px', borderRadius: 5, fontWeight: 700, fontSize: '0.82rem',
            border: 'none', cursor: 'pointer',
            background: autoRodizio ? '#10b981' : 'transparent',
            color: autoRodizio ? '#fff' : '#D0B29E',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <i className={`ph ${autoRodizio ? 'ph-arrows-clockwise' : 'ph-play'}`}></i> Auto 30s
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 700, color: '#F6BE00' }}>
            {agora.toLocaleTimeString('pt-BR')}
          </span>
          <span style={{ fontSize: '0.8rem', color: '#D0B29E' }}>{formatarDataBR(dataHoje)}</span>
          <button onClick={alternarTelaCheia} style={{ background: '#F6BE00', color: '#2A170A', padding: '6px 12px', borderRadius: 6, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
            <i className="ph ph-corners-out"></i>
          </button>
          {sair && <button onClick={sair} style={{ background: '#4A2E1A', color: 'white', padding: '6px 12px', borderRadius: 6, fontWeight: 700, border: '1px solid #734A2A', cursor: 'pointer' }}>Voltar</button>}
        </div>
      </header>

      <main style={S.main}>

        {/* ABA 1 — VISÃO GERAL */}
        {aba === 'producao' && (
          <>
            {carregando && <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>Carregando...</div>}
            {!carregando && !existe && <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>Nenhuma produção programada para hoje.</div>}
            {!carregando && existe && (
              <>
                <div style={{ ...S.cardDark, marginBottom: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: '2.8rem', fontWeight: 900, color: '#F6BE00', lineHeight: 1 }}>
                    {totalFeito}<span style={{ fontSize: '1.4rem', color: '#D0B29E', fontWeight: 700 }}> / {totalProgramado}</span>
                  </div>
                  <div style={{ ...S.label, marginTop: 4 }}>receitas produzidas hoje</div>
                  <div style={{ marginTop: 10, background: '#3D2515', borderRadius: 20, height: 12, overflow: 'hidden' }}>
                    <div style={{ background: '#F6BE00', height: '100%', width: pctGeral + '%', transition: 'width 1s', borderRadius: 20 }}></div>
                  </div>
                  <div style={{ marginTop: 4, fontSize: '0.85rem', fontWeight: 700, color: '#F6BE00' }}>{pctGeral}%</div>
                </div>

                {Object.entries(porCategoria).map(([cat, catItens]) => (
                  <div key={cat} style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#F6BE00', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>{cat}</div>
                    <div style={{ display: 'grid', gap: 12 }}>
                      {catItens.map((item, idx) => {
                        const perc = item.metaLotes ? Math.min(100, Math.round((item.feitos || 0) / item.metaLotes * 100)) : 0;
                        const concluido = (item.feitos || 0) >= item.metaLotes;
                        return (
                          <div key={idx} style={{ ...S.card, borderLeft: `4px solid ${concluido ? '#15803d' : item === itemAtivo ? '#F6BE00' : '#734A2A'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <div style={{ fontWeight: 700, color: 'white' }}>{item.produto}</div>
                              <div style={{ fontFamily: 'monospace', color: '#D0B29E' }}>
                                <span style={{ fontSize: '1.4rem', fontWeight: 900, color: concluido ? '#4ade80' : '#F6BE00' }}>{item.feitos || 0}</span>
                                {' '}/{' '}{item.metaLotes}
                              </div>
                            </div>
                            <div style={{ background: '#3D2515', borderRadius: 20, height: 10, overflow: 'hidden' }}>
                              <div style={{ background: concluido ? '#15803d' : '#F6BE00', height: '100%', width: perc + '%', transition: 'width 1s', borderRadius: 20 }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ABA 2 — MASSEIRA */}
        {aba === 'masseira' && (
          <>
            <h3 style={S.h3}><i className="ph ph-bowl-food" style={{ color: '#F6BE00', marginRight: 8 }}></i>Produção Masseira</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div style={{ ...S.cardDark, textAlign: 'center' }}>
                <div style={S.label}>⚡ Velocidade geral</div>
                <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#F6BE00', marginTop: 6 }}>
                  {velocidadeGeral != null ? velocidadeGeral.toFixed(2) : '—'}
                  <span style={{ fontSize: '0.9rem', color: '#D0B29E', marginLeft: 4 }}>rec/min</span>
                </div>
              </div>
              <div style={{ ...S.cardDark, textAlign: 'center' }}>
                <div style={S.label}>🕐 Última receita na masseira</div>
                <div style={{ fontSize: '2.2rem', fontWeight: 900, color: ultimaBatidaGeral ? '#4ade80' : '#6b7280', marginTop: 6 }}>
                  {tempoDecorrido(ultimaBatidaGeral)}
                  {ultimaBatidaGeral && <span style={{ fontSize: '0.85rem', color: '#D0B29E', marginLeft: 4 }}>atrás</span>}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              {ordenados.map((item, idx) => {
                const perc = item.metaLotes ? Math.min(100, Math.round((item.feitos || 0) / item.metaLotes * 100)) : 0;
                const concluido = (item.feitos || 0) >= item.metaLotes;
                const vel = velItem(item);
                const ub = item.batidas?.at(-1);
                return (
                  <div key={idx} style={{ ...S.card, borderLeft: `4px solid ${concluido ? '#15803d' : item === itemAtivo ? '#F6BE00' : '#734A2A'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      {/* Nome + velocidade */}
                      <div>
                        <div style={{ fontWeight: 700, color: 'white', fontSize: '1.1rem' }}>{item.produto}</div>
                        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
                          {vel != null && !concluido && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#3D2515', border: '1px solid #734A2A', borderRadius: 20, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, color: '#F6BE00' }}>
                              ⚡ {vel.toFixed(1)} <span style={{ color: '#D0B29E', fontWeight: 400 }}>rec/min</span>
                            </span>
                          )}
                          {ub && !concluido && (
                            <span style={{ fontSize: '0.72rem', color: '#D0B29E' }}>
                              🕐 há {tempoDecorrido(ub)}
                            </span>
                          )}
                          {concluido && (
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4ade80' }}>✔ Concluído</span>
                          )}
                        </div>
                      </div>
                      {/* Contador */}
                      <div style={{ textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>
                        <span style={{ fontSize: '1.8rem', fontWeight: 900, color: concluido ? '#4ade80' : '#F6BE00' }}>{item.feitos || 0}</span>
                        <span style={{ color: '#D0B29E', fontSize: '1rem' }}> / {item.metaLotes}</span>
                      </div>
                    </div>
                    <div style={{ background: '#3D2515', borderRadius: 20, height: 12, overflow: 'hidden' }}>
                      <div style={{ background: concluido ? '#15803d' : '#F6BE00', height: '100%', width: perc + '%', transition: 'width 1s', borderRadius: 20 }}></div>
                    </div>
                  </div>
                );
              })}
              {ordenados.length === 0 && <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>Nenhuma produção programada para hoje.</div>}
            </div>
          </>
        )}

        {/* ABA 3 — ESTOQUE PA */}
        {aba === 'estoque_pa' && (
          <>
            <h3 style={S.h3}><i className="ph ph-snowflake" style={{ color: '#F6BE00', marginRight: 8 }}></i>Estoque Produto Acabado</h3>
            {estoquePA.length === 0 && <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>Aguardando dados...</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
              {estoquePA.map((item, i) => {
                const abaixoMin = item.estoqueMinimo > 0 && item.estoqueAtual <= item.estoqueMinimo;
                const cobDias   = item.coberturaDias ?? (item.mediaSaidaDiaria > 0 ? item.estoqueAtual / item.mediaSaidaDiaria : null);
                const emAviso   = !abaixoMin && cobDias != null && cobDias < 2;
                const corBorda  = abaixoMin ? '#dc2626' : emAviso ? '#f59e0b' : '#734A2A';
                const corVal    = abaixoMin ? '#f87171' : emAviso ? '#fbbf24' : '#4ade80';
                return (
                  <div key={i} style={{ background: '#4A2E1A', border: `2px solid ${corBorda}`, borderRadius: 14, padding: 16 }}>
                    <div style={{ fontWeight: 900, color: 'white', marginBottom: 8 }}>{item.produto}</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 900, color: corVal }}>
                      {item.estoqueAtual} <span style={{ fontSize: '0.85rem', color: '#D0B29E' }}>{item.unidade}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: '0.75rem', color: '#D0B29E', flexWrap: 'wrap' }}>
                      {item.saida24h != null && <span>24h: <b style={{ color: 'white' }}>{item.saida24h}</b></span>}
                      {item.saida48h != null && <span>48h: <b style={{ color: 'white' }}>{item.saida48h}</b></span>}
                      {item.mediaSaidaDiaria > 0 && <span>Média/dia: <b style={{ color: 'white' }}>{item.mediaSaidaDiaria.toFixed(0)}</b></span>}
                    </div>
                    {cobDias != null && (
                      <div style={{ marginTop: 8, padding: '5px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.7rem', color: '#D0B29E' }}>Cobertura</span>
                        <span style={{ fontWeight: 900, color: corVal }}>{cobDias < 0.1 ? '< 0.1' : cobDias.toFixed(1)} dias</span>
                      </div>
                    )}
                    {abaixoMin && <div style={{ marginTop: 8, background: '#5c1a1a', color: '#f87171', fontWeight: 800, fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, display: 'inline-block' }}>ABAIXO DO MÍNIMO</div>}
                    {emAviso && !abaixoMin && <div style={{ marginTop: 8, background: '#5c3a21', color: '#fbbf24', fontWeight: 800, fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, display: 'inline-block' }}>COBRE {cobDias.toFixed(1)} DIAS</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ABA 4 — ESTOQUE MP */}
        {aba === 'estoque_mp' && (
          <>
            <h3 style={S.h3}><i className="ph ph-package" style={{ color: '#F6BE00', marginRight: 8 }}></i>Estoque Matéria-Prima</h3>
            {carregandoMP && <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>Carregando...</div>}
            {!carregandoMP && estoqueMP.length === 0 && (
              <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>
                Nenhum item encontrado.<br />
                <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>Verifique a conexão com o sistema de estoque.</span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {estoqueMP.map(item => {
                const abaixoMin = item.minimo > 0 && item.saldo <= item.minimo;
                const semEstoque = item.saldo <= 0;
                const corBorda = semEstoque ? '#dc2626' : abaixoMin ? '#f59e0b' : '#734A2A';
                const corSaldo = semEstoque ? '#f87171' : abaixoMin ? '#fbbf24' : '#4ade80';
                const percMin  = item.minimo > 0 ? Math.min(100, Math.round((item.saldo / item.minimo) * 100)) : null;
                return (
                  <div key={item.id} style={{ background: '#4A2E1A', border: `2px solid ${corBorda}`, borderRadius: 14, padding: 16 }}>
                    <div style={{ fontWeight: 700, color: 'white', marginBottom: 10, lineHeight: 1.3 }}>{item.nome}</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 900, color: corSaldo }}>
                      {item.saldo.toFixed(2)} <span style={{ fontSize: '0.85rem', color: '#D0B29E' }}>{item.unidade}</span>
                    </div>
                    {percMin != null && (
                      <>
                        <div style={{ marginTop: 8, background: '#3D2515', borderRadius: 20, height: 6, overflow: 'hidden' }}>
                          <div style={{ background: corSaldo, height: '100%', width: percMin + '%', transition: 'width 0.5s' }}></div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: '0.68rem', color: '#D0B29E' }}>
                          <span>{percMin}% do mínimo</span>
                          <span>Mín: {item.minimo} {item.unidade}</span>
                        </div>
                      </>
                    )}
                    {semEstoque && <div style={{ marginTop: 8, background: '#5c1a1a', color: '#f87171', fontWeight: 800, fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, display: 'inline-block' }}>SEM ESTOQUE</div>}
                    {!semEstoque && abaixoMin && <div style={{ marginTop: 8, background: '#5c3a21', color: '#fbbf24', fontWeight: 800, fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, display: 'inline-block' }}>ABAIXO DO MÍNIMO</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}

      </main>
    </div>
  );
}
