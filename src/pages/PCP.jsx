import { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../services/auth';
import { hojeISO, paraISO, formatarDataBR, formatarKg } from '../services/utils';

// ── Modal de correção manual de rendimento ────────────────────────
function ModalCorrigirRendimento({ item, aoSalvar, aoFechar, salvando }) {
  const [valor, setValor] = useState(item.rendimentoUnit || '');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }} onClick={aoFechar}>
      <div style={{ background: 'white', width: '100%', maxWidth: 480, margin: '0 auto', borderRadius: '20px 20px 0 0', padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--marrom)' }}>Corrigir rendimento</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--marrom-claro)', marginTop: 2 }}>{item.produto}</div>
          </div>
          <button onClick={aoFechar} style={{ background: 'none', border: 'none', fontSize: '1.3rem', color: '#999', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ background: 'var(--warning-soft)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: '0.8rem', color: 'var(--marrom)' }}>
          Use quando a bridge estava fora do ar e o rendimento veio zerado ou incorreto do Winthor. Isso corrige apenas este produto, nesta data.
        </div>

        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>
          Rendimento por receita (kg)
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="input-texto"
          value={valor}
          onChange={e => setValor(e.target.value)}
          placeholder="Ex: 4.50"
          autoFocus
        />

        <div style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--marrom-claro)' }}>
          {item.feitos} receita{item.feitos > 1 ? 's' : ''} realizada{item.feitos > 1 ? 's' : ''} × {valor || 0} kg = <strong>{formatarKg((parseFloat(valor) || 0) * item.feitos)} kg</strong>
        </div>

        <button
          onClick={() => { if (!valor || isNaN(parseFloat(valor))) { alert('Insira um valor válido.'); return; } aoSalvar(parseFloat(valor)); }}
          disabled={salvando}
          style={{ width: '100%', marginTop: 18, padding: 15, borderRadius: 12, border: 'none', background: 'var(--marrom)', color: 'white', fontWeight: 900, fontSize: '0.95rem', cursor: 'pointer' }}
        >
          {salvando ? 'Salvando...' : 'Salvar correção'}
        </button>
      </div>
    </div>
  );
}

export default function PCP() {
  const { currentUser } = useAuth();
  const isPcp = currentUser?.setor === 'pcp';

  const [dataAlvo, setDataAlvo] = useState(hojeISO());
  const [carregando, setCarregando] = useState(true);
  const [registros, setRegistros] = useState([]);
  const [itensProducao, setItensProducao] = useState([]);
  const [modalCorrigir, setModalCorrigir] = useState(null); // { codigo, produto, rendimentoUnit, feitos }
  const [salvandoCorrecao, setSalvandoCorrecao] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [solicitandoSync, setSolicitandoSync] = useState(false);

  // Escuta status da bridge em tempo real (só para PCP)
  useEffect(() => {
    if (!isPcp) return;
    const unsub = onSnapshot(doc(db, 'bridge', 'status'), snap => {
      if (snap.exists()) setSyncStatus(snap.data());
    });
    return () => unsub();
  }, [isPcp]);

  async function solicitarSincronizacao() {
    if (solicitandoSync || syncStatus?.rodando) return;
    setSolicitandoSync(true);
    try {
      await setDoc(doc(db, 'bridge', 'comando'), {
        acao: 'sincronizar',
        solicitadoEm: new Date().toISOString(),
      });
    } catch (e) {
      alert('Erro ao solicitar sincronização: ' + e.message);
    } finally {
      setSolicitandoSync(false);
    }
  }

  useEffect(() => {
    setCarregando(true);
    const unsubExp = onSnapshot(doc(db, 'expedicaoDiaria', dataAlvo), snap => {
      if (snap.exists() && snap.data().registros) setRegistros(snap.data().registros);
      else setRegistros([]);
      setCarregando(false);
    });
    const unsubProd = onSnapshot(doc(db, 'producaoDiaria', dataAlvo), snap => {
      if (snap.exists() && snap.data().itens) setItensProducao(snap.data().itens);
      else setItensProducao([]);
    });
    return () => { unsubExp(); unsubProd(); };
  }, [dataAlvo]);

  function mudarDia(delta) {
    const d = new Date(dataAlvo + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setDataAlvo(paraISO(d));
  }

  async function salvarCorrecaoRendimento(novoValor) {
    setSalvandoCorrecao(true);
    try {
      const novaLista = itensProducao.map(it =>
        it.codigo === modalCorrigir.codigo
          ? { ...it, rendimentoTeorico: novoValor, rendimentoCorrigidoManualmente: true, rendimentoCorrigidoEm: new Date().toISOString() }
          : it
      );
      await updateDoc(doc(db, 'producaoDiaria', dataAlvo), { itens: novaLista });
      setModalCorrigir(null);
    } catch (e) {
      alert('Erro ao salvar correção: ' + e.message);
    } finally {
      setSalvandoCorrecao(false);
    }
  }

  if (carregando) return <div className="status-msg">Buscando dados...</div>;

  // ── Real: agrupa entradas da câmara por código de produto ──
  const realPorCodigo = {};
  registros.forEach(r => {
    const cod = r.codigoProduto;
    if (!cod) return;
    if (!realPorCodigo[cod]) realPorCodigo[cod] = { pesoTotal: 0, patinhas: 0, lotes: new Set(), ops: new Set() };
    realPorCodigo[cod].pesoTotal += r.pesoTotal || r.peso || 0;
    realPorCodigo[cod].patinhas += 1;
    if (r.lote) realPorCodigo[cod].lotes.add(r.lote);
    (r.ops || []).forEach(op => realPorCodigo[cod].ops.add(op));
  });

  // ── Teórico: fórmula do fechamento do líder ──
  const teoricoPorCodigo = {};
  itensProducao.forEach(it => {
    if (!it.codigo) return;
    const bruto = (it.rendimentoTeorico || 0) * (it.feitos || 0);
    const perdas = (it.massaPerdidaProd || 0) + (it.massaPerdidaEmb || 0);
    const pe = it.peDeMassa || 0;
    teoricoPorCodigo[it.codigo] = {
      produto: it.produto,
      teorico: bruto - perdas + pe,
      bruto,
      perdas,
      peDeMassa: pe,
      feitos: it.feitos || 0,
      metaLotes: it.metaLotes || 0,
      rendimentoUnit: it.rendimentoTeorico || 0,
      finalizado: !!it.finalizado,
      ops: it.ops || [],
      corrigidoManualmente: !!it.rendimentoCorrigidoManualmente,
    };
  });

  const codigos = Array.from(new Set([...Object.keys(teoricoPorCodigo), ...Object.keys(realPorCodigo)]));
  const lista = codigos
    .map(cod => {
      const t = teoricoPorCodigo[cod] || null;
      const r = realPorCodigo[cod] || null;
      if ((!t || t.feitos === 0) && !r) return null;
      return { codigo: cod, teorico: t, real: r };
    })
    .filter(Boolean)
    .sort((a, b) => (a.teorico?.produto || '').localeCompare(b.teorico?.produto || '', 'pt-BR'));

  return (
    <div className="container">
      <div className="toolbar toolbar-data">
        <button className="arrow-btn" onClick={() => mudarDia(-1)}>‹</button>
        <div className="toolbar-data-centro">
          <div style={{ fontWeight: 800 }}>{formatarDataBR(dataAlvo)}</div>
          <input type="date" className="input-data" value={dataAlvo} onChange={e => e.target.value && setDataAlvo(e.target.value)} />
        </div>
        <button className="arrow-btn" onClick={() => mudarDia(1)}>›</button>
      </div>

      <div className="cat-heading">Teórico (Líder) × Real (Câmara)</div>

      {/* Botão de sincronização — apenas PCP */}
      {isPcp && (
        <div style={{ margin: '0 0 16px', padding: '14px 16px', background: 'white', borderRadius: 14, border: '1px solid var(--border-suave)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={solicitarSincronizacao}
            disabled={solicitandoSync || syncStatus?.rodando}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 18px', borderRadius: 10, border: 'none',
              background: syncStatus?.rodando ? 'var(--border-suave)' : 'var(--marrom)',
              color: syncStatus?.rodando ? 'var(--marrom-claro)' : 'white',
              fontWeight: 800, fontSize: '0.85rem', cursor: syncStatus?.rodando ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            <i className={`ph ${syncStatus?.rodando ? 'ph-spinner' : 'ph-arrows-clockwise'}`}
               style={syncStatus?.rodando ? { animation: 'spin 1s linear infinite' } : {}}></i>
            {syncStatus?.rodando ? 'Sincronizando...' : 'Sincronizar Winthor'}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            {syncStatus ? (
              <>
                <div style={{ fontSize: '0.78rem', color: 'var(--marrom)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {syncStatus.mensagem || '—'}
                </div>
                {syncStatus.ultimaSincronizacao && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--marrom-claro)', marginTop: 2 }}>
                    Última sync: {new Date(syncStatus.ultimaSincronizacao).toLocaleString('pt-BR')}
                  </div>
                )}
                {syncStatus.rodando && syncStatus.progresso > 0 && (
                  <div style={{ marginTop: 6, height: 4, background: 'var(--border-suave)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'var(--marrom)', borderRadius: 4, width: `${syncStatus.progresso}%`, transition: 'width 0.4s ease' }} />
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: '0.78rem', color: 'var(--marrom-claro)' }}>Bridge não reportou status ainda.</div>
            )}
          </div>
        </div>
      )}

      {lista.length === 0 && (
        <div className="status-msg">Nenhuma produção ou entrada na câmara nesse dia.</div>
      )}

      {lista.map(({ codigo, teorico: t, real: r }) => {
        const valorTeorico = t?.teorico ?? null;
        const valorReal = r?.pesoTotal ?? null;

        let divPct = null;
        if (valorTeorico != null && valorTeorico > 0 && valorReal != null) {
          divPct = ((valorReal - valorTeorico) / valorTeorico) * 100;
        }
        const divOk = divPct != null && Math.abs(divPct) <= 3;
        const divCor = divPct == null ? '#999' : divOk ? 'var(--success)' : Math.abs(divPct) <= 8 ? 'var(--warning)' : 'var(--danger)';
        const divBg = divPct == null ? 'var(--border-suave)' : divOk ? 'var(--success-soft)' : Math.abs(divPct) <= 8 ? 'var(--warning-soft)' : 'var(--danger-soft)';
        const divFmt = divPct == null ? '—' : (divPct > 0 ? '+' : '') + divPct.toFixed(2) + '%';

        const nomeProduto = t?.produto || registros.find(x => x.codigoProduto === codigo)?.produto || codigo;
        const ops = t?.ops?.length ? t.ops : (r ? Array.from(r.ops) : []);
        const rendimentoSuspeito = t && t.feitos > 0 && t.rendimentoUnit === 0;

        return (
          <div className="card" key={codigo} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '16px 18px 12px' }}>
              <div>
                <div className="nome">{nomeProduto}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--marrom-claro)', fontFamily: 'monospace', fontWeight: 600, marginTop: 2 }}>
                  CÓD: {codigo}{ops.length > 0 && <> · OP: {ops.join(', ')}</>}
                </div>
              </div>
              {t?.finalizado
                ? <span className="selo-ok">Fechado</span>
                : t && <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--warning)', background: 'var(--warning-soft)', padding: '4px 10px', borderRadius: 20 }}>Fechamento pendente</span>
              }
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--border-suave)' }}>

              {/* Teórico (Líder) */}
              <div style={{ padding: '14px 18px', borderRight: '1px solid var(--border-suave)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ fontSize: '0.64rem', fontWeight: 800, color: 'var(--marrom-claro)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <i className="ph ph-clipboard-text" style={{ marginRight: 4 }}></i>Teórico (Líder)
                  </div>
                  {isPcp && t && t.feitos > 0 && (
                    <button
                      onClick={() => setModalCorrigir({ codigo, produto: nomeProduto, rendimentoUnit: t.rendimentoUnit, feitos: t.feitos })}
                      title="Corrigir rendimento manualmente"
                      style={{ background: 'none', border: 'none', color: rendimentoSuspeito ? 'var(--danger)' : 'var(--marrom-claro)', cursor: 'pointer', fontSize: '0.9rem', padding: 2 }}
                    >
                      <i className="ph ph-pencil-simple"></i>
                    </button>
                  )}
                </div>

                {rendimentoSuspeito && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: '0.68rem', fontWeight: 700, padding: '3px 8px', borderRadius: 20, marginBottom: 6 }}>
                    <i className="ph ph-warning-circle"></i> Rendimento zerado — bridge fora do ar?
                  </div>
                )}
                {t?.corrigidoManualmente && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--info-soft)', color: 'var(--info)', fontSize: '0.68rem', fontWeight: 700, padding: '3px 8px', borderRadius: 20, marginBottom: 6 }}>
                    <i className="ph ph-pencil-simple"></i> Corrigido manualmente
                  </div>
                )}

                {valorTeorico != null && t.feitos > 0
                  ? <>
                      <div style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--marrom)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatarKg(valorTeorico)} <span style={{ fontSize: '0.8rem', color: 'var(--marrom-claro)', fontWeight: 700 }}>kg</span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--marrom-claro)', marginTop: 6, lineHeight: 1.7 }}>
                        {formatarKg(t.rendimentoUnit)} kg × {t.feitos} receita{t.feitos > 1 ? 's' : ''} = {formatarKg(t.bruto)} kg<br />
                        {t.perdas > 0 && <>− {formatarKg(t.perdas)} kg perdas<br /></>}
                        {t.peDeMassa > 0 && <>+ {formatarKg(t.peDeMassa)} kg pé de massa<br /></>}
                      </div>
                    </>
                  : <div style={{ fontSize: '0.82rem', color: '#c4b494', fontStyle: 'italic', paddingTop: 6 }}>Sem produção registrada</div>
                }
              </div>

              {/* Real (Câmara) */}
              <div style={{ padding: '14px 18px' }}>
                <div style={{ fontSize: '0.64rem', fontWeight: 800, color: 'var(--marrom-claro)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  <i className="ph ph-snowflake" style={{ marginRight: 4 }}></i>Real (Câmara)
                </div>
                {valorReal != null
                  ? <>
                      <div style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--success)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatarKg(valorReal)} <span style={{ fontSize: '0.8rem', color: 'var(--marrom-claro)', fontWeight: 700 }}>kg</span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--marrom-claro)', marginTop: 6, lineHeight: 1.7 }}>
                        {r.patinhas} patinha{r.patinhas > 1 ? 's' : ''} conferida{r.patinhas > 1 ? 's' : ''}<br />
                        {r.lotes.size > 0 && <>Lote{r.lotes.size > 1 ? 's' : ''}: {Array.from(r.lotes).join(', ')}</>}
                      </div>
                    </>
                  : <div style={{ fontSize: '0.82rem', color: '#c4b494', fontStyle: 'italic', paddingTop: 6 }}>Nada entrou na câmara</div>
                }
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderTop: '1px solid var(--border-suave)', background: '#fdfcfa' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--marrom-claro)' }}>Divergência Real × Teórico</span>
              <span style={{ fontWeight: 900, fontSize: '0.9rem', color: divCor, background: divBg, padding: '4px 12px', borderRadius: 20, fontVariantNumeric: 'tabular-nums' }}>
                {divFmt}
              </span>
            </div>
          </div>
        );
      })}

      {modalCorrigir && (
        <ModalCorrigirRendimento
          item={modalCorrigir}
          aoSalvar={salvarCorrecaoRendimento}
          aoFechar={() => setModalCorrigir(null)}
          salvando={salvandoCorrecao}
        />
      )}
    </div>
  );
}
