import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { hojeISO, paraISO, formatarDataBR, formatarKg } from '../services/utils';

export default function PCP() {
  const [dataAlvo, setDataAlvo] = useState(hojeISO());
  const [carregando, setCarregando] = useState(true);
  const [registros, setRegistros] = useState([]);
  const [itensProducao, setItensProducao] = useState([]);

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
  // teorico = rendimento Winthor × receitas realizadas − perdas + pé de massa
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
    };
  });

  // ── União: um card por produto que apareceu em qualquer um dos lados ──
  const codigos = Array.from(new Set([...Object.keys(teoricoPorCodigo), ...Object.keys(realPorCodigo)]));
  const lista = codigos
    .map(cod => {
      const t = teoricoPorCodigo[cod] || null;
      const r = realPorCodigo[cod] || null;
      // Ignora itens programados que ainda não produziram nada nem entraram na câmara
      if ((!t || t.feitos === 0) && !r) return null;
      return { codigo: cod, teorico: t, real: r };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const nomeA = a.teorico?.produto || '';
      const nomeB = b.teorico?.produto || '';
      return nomeA.localeCompare(nomeB, 'pt-BR');
    });

  return (
    <div className="container">
      {/* Navegação de data */}
      <div className="toolbar toolbar-data">
        <button className="arrow-btn" onClick={() => mudarDia(-1)}>‹</button>
        <div className="toolbar-data-centro">
          <div style={{ fontWeight: 800 }}>{formatarDataBR(dataAlvo)}</div>
          <input type="date" className="input-data" value={dataAlvo} onChange={e => e.target.value && setDataAlvo(e.target.value)} />
        </div>
        <button className="arrow-btn" onClick={() => mudarDia(1)}>›</button>
      </div>

      <div className="cat-heading">Teórico (Líder) × Real (Câmara)</div>

      {lista.length === 0 && (
        <div className="status-msg">Nenhuma produção ou entrada na câmara nesse dia.</div>
      )}

      {lista.map(({ codigo, teorico: t, real: r }) => {
        const valorTeorico = t?.teorico ?? null;
        const valorReal = r?.pesoTotal ?? null;

        // Divergência real vs teórico
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

        return (
          <div className="card" key={codigo} style={{ padding: 0, overflow: 'hidden' }}>
            {/* Cabeçalho */}
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

            {/* Painel duplo: Teórico × Real */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--border-suave)' }}>

              {/* Teórico (Líder) */}
              <div style={{ padding: '14px 18px', borderRight: '1px solid var(--border-suave)' }}>
                <div style={{ fontSize: '0.64rem', fontWeight: 800, color: 'var(--marrom-claro)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  <i className="ph ph-clipboard-text" style={{ marginRight: 4 }}></i>Teórico (Líder)
                </div>
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

            {/* Rodapé: divergência */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderTop: '1px solid var(--border-suave)', background: '#fdfcfa' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--marrom-claro)' }}>Divergência Real × Teórico</span>
              <span style={{ fontWeight: 900, fontSize: '0.9rem', color: divCor, background: divBg, padding: '4px 12px', borderRadius: 20, fontVariantNumeric: 'tabular-nums' }}>
                {divFmt}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
