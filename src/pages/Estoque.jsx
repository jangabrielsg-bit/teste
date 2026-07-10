import { useState, useEffect } from 'react';
import { collection, onSnapshot, getDocs, getDoc, doc, writeBatch, increment, setDoc, addDoc } from 'firebase/firestore';
import { db, dbEstoqueOS } from '../services/firebase';
import { useAuth } from '../services/auth';
import { useProdutos } from '../services/hooks';

// ── Hook: Estoque PA Winthor (bridge) ─────────────────────────────
function useEstoqueWinthorPA() {
  const [dados, setDados] = useState({});
  const [atualizadoEm, setAtualizadoEm] = useState(null);
  useEffect(() => {
    return onSnapshot(collection(db, 'estoquePA'), snap => {
      const mapa = {};
      let ultima = '';
      snap.forEach(d => {
        const item = d.data();
        const chave = (item.codigo || '').trim();
        if (chave) mapa[chave] = { ...item, id: d.id };
        if (item.atualizadoEm && item.atualizadoEm > ultima) ultima = item.atualizadoEm;
      });
      setDados(mapa);
      if (ultima) setAtualizadoEm(ultima);
    });
  }, []);
  return { dados, atualizadoEm };
}

// ── Hook: Estoque PA Físico (entradas da expedição) ───────────────
function useEstoquePAFisico() {
  const [dados, setDados] = useState({});
  useEffect(() => {
    return onSnapshot(collection(db, 'estoquePAFisico'), snap => {
      const mapa = {};
      snap.forEach(d => { mapa[d.id] = { ...d.data(), id: d.id }; });
      setDados(mapa);
    });
  }, []);
  return dados;
}

// ── Helpers ───────────────────────────────────────────────────────
function fmtQtd(n, un) {
  if (n == null || !isFinite(n)) return '—';
  return `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${un || 'UN'}`;
}
function fmtHoras(h) {
  if (h == null || !isFinite(h) || h > 9999) return '—';
  if (h < 24) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}
function horaCurta(iso) {
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

// ── Modal de Ajuste Físico PA (só PCP) ───────────────────────────
function ModalAjusteFisico({ item, winthorEntry, aoFechar }) {
  const [modo, setModo] = useState('ajuste'); // 'ajuste' | 'entrada' | 'saida'
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);

  const saldoAtual = item?.saldoFisico || 0;
  const unidade    = item?.unidade || winthorEntry?.unidade || 'UN';
  const codigo     = item?.codigo || winthorEntry?.codigo;
  const produto    = item?.produto || winthorEntry?.produto;

  async function salvar() {
    if (!valor || isNaN(parseFloat(valor))) return alert('Insira um valor válido.');
    if (!motivo.trim()) return alert('Informe o motivo do ajuste.');
    setSalvando(true);
    try {
      const n = parseFloat(valor);
      let delta = 0;
      let tipo = '';
      if (modo === 'ajuste') {
        delta = n - saldoAtual;
        tipo = 'AJUSTE_INVENTARIO';
      } else if (modo === 'entrada') {
        delta = n;
        tipo = 'ENTRADA_MANUAL';
      } else {
        delta = -n;
        tipo = 'SAIDA_MANUAL';
      }

      const batch = writeBatch(db);

      // Atualiza saldo no documento principal
      const refSaldo = doc(db, 'estoquePAFisico', codigo);
      batch.set(refSaldo, {
        codigo,
        produto,
        saldoFisico:  increment(delta),
        unidade,
        ultimoAjuste: new Date().toISOString(),
      }, { merge: true });

      // Registra no histórico de ajustes
      const refMov = doc(collection(db, 'estoquePAFisico', codigo, 'ajustes'));
      batch.set(refMov, {
        tipo,
        saldoAntes:   saldoAtual,
        valor:        n,
        delta,
        motivo:       motivo.trim(),
        registradoEm: new Date().toISOString(),
      });

      await batch.commit();
      alert('Ajuste salvo!');
      aoFechar();
    } catch (e) {
      alert('Erro: ' + e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }} onClick={aoFechar}>
      <div style={{ background: 'white', width: '100%', maxWidth: 500, margin: '0 auto', borderRadius: '20px 20px 0 0', padding: 24, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--marrom)' }}>{produto}</div>
            <div style={{ fontSize: '0.75rem', color: '#999', marginTop: 2 }}>CÓD: {codigo} · Saldo atual: {fmtQtd(saldoAtual, unidade)}</div>
          </div>
          <button onClick={aoFechar} style={{ background: 'none', border: 'none', fontSize: '1.4rem', color: '#999', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Tipo de operação */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {[['ajuste', '🎯 Inventário'], ['entrada', '📥 Entrada'], ['saida', '📤 Saída']].map(([m, label]) => (
            <button key={m} onClick={() => setModo(m)} style={{ flex: 1, padding: '10px 8px', borderRadius: 10, border: '2px solid', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', background: modo === m ? 'var(--amarelo)' : 'white', borderColor: modo === m ? 'var(--amarelo)' : 'var(--border-suave)', color: modo === m ? 'var(--marrom)' : '#999' }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ background: 'var(--amarelo-claro)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: '0.82rem', color: 'var(--marrom)' }}>
          {modo === 'ajuste' && <><strong>Inventário:</strong> informe o saldo real contado — o sistema calcula a diferença automaticamente.</>}
          {modo === 'entrada' && <><strong>Entrada manual:</strong> quantidade a adicionar ao saldo (ex: transferência não registrada).</>}
          {modo === 'saida'  && <><strong>Saída manual:</strong> quantidade a remover do saldo (ex: descarte, expedição retroativa).</>}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>
            {modo === 'ajuste' ? `Saldo real contado (${unidade})` : `Quantidade (${unidade})`}
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="input-texto"
            value={valor}
            onChange={e => setValor(e.target.value)}
            placeholder={modo === 'ajuste' ? `Saldo atual: ${saldoAtual.toFixed(2)}` : '0.00'}
          />
          {modo === 'ajuste' && valor && !isNaN(parseFloat(valor)) && (
            <div style={{ marginTop: 6, fontSize: '0.82rem', fontWeight: 700, color: parseFloat(valor) - saldoAtual >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              Diferença: {parseFloat(valor) - saldoAtual >= 0 ? '+' : ''}{(parseFloat(valor) - saldoAtual).toFixed(2)} {unidade}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Motivo / Observação</label>
          <input className="input-texto" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex: Contagem física de câmara, Descarte por vencimento..." />
        </div>

        <button
          onClick={salvar}
          disabled={salvando}
          style={{ width: '100%', padding: 16, borderRadius: 12, border: 'none', background: 'var(--marrom)', color: 'white', fontWeight: 900, fontSize: '1rem', cursor: 'pointer' }}
        >
          {salvando ? 'Salvando...' : 'Confirmar Ajuste'}
        </button>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────
export default function Estoque() {
  const { currentUser } = useAuth();
  const { produtos } = useProdutos();
  const isPcp = currentUser?.setor === 'pcp';

  const [estoqueAtual, setEstoqueAtual]         = useState([]);
  const [termoBuscaEstoque, setTermoBuscaEstoque] = useState('');
  const [subAbaEstoque, setSubAbaEstoque]         = useState('acabado');
  const [modalLotesProduto, setModalLotesProduto] = useState(null);
  const [modalAjuste, setModalAjuste]             = useState(null); // { fisico, winthor }

  const [estoqueWinthorSistema, setEstoqueWinthorSistema] = useState({});
  const [estoqueMP, setEstoqueMP]               = useState([]);
  const [carregandoMP, setCarregandoMP]         = useState(false);

  const { dados: winthorPA, atualizadoEm: paAtualizadoEm } = useEstoqueWinthorPA();
  const fisicoPA = useEstoquePAFisico();

  // Estoque físico por lotes (coleção 'estoque')
  useEffect(() => {
    return onSnapshot(collection(db, 'estoque'), snap => {
      const est = [];
      snap.forEach(d => est.push({ ...d.data(), id: d.id }));
      setEstoqueAtual(est);
    });
  }, []);

  // Matéria Prima
  useEffect(() => {
    if (subAbaEstoque === 'mp' && isPcp) {
      setCarregandoMP(true);
      (async () => {
        try {
          const winRef = await getDocs(collection(db, 'winthorEstoqueSistema'));
          const winthorData = {};
          winRef.forEach(d => { winthorData[d.id] = d.data().saldoWinthor || 0; });
          setEstoqueWinthorSistema(winthorData);

          const cDoc = await getDoc(doc(dbEstoqueOS, 'global_settings', 'company_db'));
          if (cDoc.exists() && cDoc.data().masterUid) {
            const mUid = cDoc.data().masterUid;
            const [invS, batS] = await Promise.all([
              getDocs(collection(dbEstoqueOS, 'users', mUid, 'inventory')),
              getDocs(collection(dbEstoqueOS, 'users', mUid, 'batches'))
            ]);
            const batMap = {};
            batS.forEach(b => { const bd = b.data(); const pid = bd.productId || bd.item_id; if (!batMap[pid]) batMap[pid] = []; if ((bd.quantity || 0) > 0) batMap[pid].push({ id: b.id, ...bd }); });
            const mpList = [];
            invS.forEach(d => {
              const inv = d.data();
              mpList.push({ id: d.id, codigo: inv.code || d.id, nome: inv.name, und: inv.unit || 'kg', lotes: batMap[d.id] || [], totalFisico: (batMap[d.id] || []).reduce((acc, l) => acc + (parseFloat(l.quantity) || 0), 0) });
            });
            setEstoqueMP(mpList.sort((a, b) => a.nome.localeCompare(b.nome)));
          }
        } catch (e) { console.error('Erro MP:', e); }
        setCarregandoMP(false);
      })();
    }
  }, [subAbaEstoque, isPcp]);

  // Agrupamento lotes físicos por código
  const lotesPorCodigo = {};
  estoqueAtual.forEach(it => {
    const cod = it.codigo || it.nome;
    if (!lotesPorCodigo[cod]) lotesPorCodigo[cod] = { nome: it.nome, codigo: it.codigo, totalKg: 0, totalUnd: 0, lotes: [], und: it.und };
    if (it.und === 'kg') lotesPorCodigo[cod].totalKg += parseFloat(it.qtd || 0);
    else lotesPorCodigo[cod].totalUnd += parseFloat(it.qtd || 0);
    lotesPorCodigo[cod].lotes.push(it);
  });

  // União: todos os produtos que aparecem no Winthor PA OU no físico
  const todasChaves = new Set([
    ...Object.keys(winthorPA),
    ...Object.keys(fisicoPA),
  ]);

  let listaAcabado = Array.from(todasChaves).map(codigo => {
    const w = winthorPA[codigo];
    const f = fisicoPA[codigo];
    const lotesGrp = lotesPorCodigo[codigo] || lotesPorCodigo[w?.produto] || null;
    return {
      codigo,
      produto:     w?.produto || f?.produto || codigo,
      winthor:     w || null,
      fisico:      f || null,
      lotesGrp,
    };
  });

  if (termoBuscaEstoque) {
    const t = termoBuscaEstoque.toLowerCase();
    listaAcabado = listaAcabado.filter(g =>
      g.produto.toLowerCase().includes(t) || g.codigo.toLowerCase().includes(t)
    );
  }

  // Ordenação: críticos Winthor primeiro
  listaAcabado.sort((a, b) => {
    const nivelA = a.winthor?.estoqueAtual != null && a.winthor.estoqueAtual <= (a.winthor.estoqueMinimo || 0) ? 0
      : a.winthor?.horasAteMinimo != null && a.winthor.horasAteMinimo <= 48 ? 1 : 2;
    const nivelB = b.winthor?.estoqueAtual != null && b.winthor.estoqueAtual <= (b.winthor.estoqueMinimo || 0) ? 0
      : b.winthor?.horasAteMinimo != null && b.winthor.horasAteMinimo <= 48 ? 1 : 2;
    if (nivelA !== nivelB) return nivelA - nivelB;
    return a.produto.localeCompare(b.produto, 'pt-BR');
  });

  let mpFiltrado = estoqueMP;
  if (termoBuscaEstoque && subAbaEstoque === 'mp') {
    const t = termoBuscaEstoque.toLowerCase();
    mpFiltrado = estoqueMP.filter(g => g.nome.toLowerCase().includes(t) || (g.codigo && g.codigo.toLowerCase().includes(t)));
  }

  // Chips de resumo
  const totalCriticos = listaAcabado.filter(g => g.winthor?.estoqueAtual != null && g.winthor.estoqueAtual <= (g.winthor.estoqueMinimo || 0)).length;
  const totalAvisos   = listaAcabado.filter(g => g.winthor && !( g.winthor.estoqueAtual <= (g.winthor.estoqueMinimo || 0)) && g.winthor.horasAteMinimo != null && g.winthor.horasAteMinimo <= 48).length;

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid var(--border-suave)' }}>
        <h2 style={{ fontWeight: 900, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="ph ph-package" style={{ fontSize: '1.8rem', color: 'var(--amarelo)' }}></i>Gestão de Estoques
        </h2>
      </div>

      <div className="card">
        {/* Abas */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 className="nome">Painel de Estoque</h3>
          {isPcp && (
            <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 8, padding: 4 }}>
              <button onClick={() => setSubAbaEstoque('acabado')} style={{ padding: '8px 16px', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', border: 'none', cursor: 'pointer', background: subAbaEstoque === 'acabado' ? 'white' : 'transparent', color: subAbaEstoque === 'acabado' ? 'var(--marrom)' : '#999', boxShadow: subAbaEstoque === 'acabado' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                🧊 Produto Acabado
              </button>
              <button onClick={() => setSubAbaEstoque('mp')} style={{ padding: '8px 16px', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', border: 'none', cursor: 'pointer', background: subAbaEstoque === 'mp' ? 'white' : 'transparent', color: subAbaEstoque === 'mp' ? 'var(--marrom)' : '#999', boxShadow: subAbaEstoque === 'mp' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                📦 Matéria Prima
              </button>
            </div>
          )}
        </div>

        {/* Chips resumo PA */}
        {subAbaEstoque === 'acabado' && (totalCriticos > 0 || totalAvisos > 0) && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {totalCriticos > 0 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fde8e8', color: '#c0392b', padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.8rem' }}>
                <i className="ph ph-warning-circle"></i> {totalCriticos} crítico{totalCriticos > 1 ? 's' : ''}
              </div>
            )}
            {totalAvisos > 0 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fef3e2', color: '#e67e22', padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.8rem' }}>
                <i className="ph ph-warning"></i> {totalAvisos} aviso{totalAvisos > 1 ? 's' : ''} 48h
              </div>
            )}
            {paAtualizadoEm && (
              <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: '#a78355', fontWeight: 600 }}>
                <i className="ph ph-arrows-clockwise"></i> Winthor {horaCurta(paAtualizadoEm)}
              </div>
            )}
          </div>
        )}

        {/* Busca */}
        <div style={{ marginBottom: 16 }}>
          <input type="text" className="input-texto" placeholder="Buscar por nome ou código..." value={termoBuscaEstoque} onChange={e => setTermoBuscaEstoque(e.target.value)} />
        </div>

        {/* ── ABA: PRODUTO ACABADO ── */}
        {subAbaEstoque === 'acabado' && (
          listaAcabado.length === 0
            ? <div className="status-msg">Nenhum produto encontrado.</div>
            : <div>
                {listaAcabado.map(grp => {
                  const { codigo, produto, winthor: w, fisico: f, lotesGrp } = grp;
                  const abaixoMin = w?.estoqueAtual != null && w.estoqueAtual <= (w.estoqueMinimo || 0);
                  const emAviso   = w && !abaixoMin && w.horasAteMinimo != null && w.horasAteMinimo <= 48;
                  const borderColor = abaixoMin ? '#c0392b' : emAviso ? '#e67e22' : 'var(--border-suave)';

                  const saldoFisico = f?.saldoFisico ?? (lotesGrp ? (lotesGrp.und === 'kg' ? lotesGrp.totalKg : lotesGrp.totalUnd) : null);
                  const unidade = w?.unidade || f?.unidade || 'UN';

                  // Status baseado em config do produto
                  const prodConf = produtos.find(p => p.codigo === codigo || p.nome === produto);
                  let statusTag = null;
                  if (prodConf && saldoFisico != null) {
                    if (prodConf.estoqueMinAcabado > 0 && saldoFisico < prodConf.estoqueMinAcabado)
                      statusTag = { text: 'Físico Baixo', style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' } };
                    else if (prodConf.estoqueMaxAcabado > 0 && saldoFisico > prodConf.estoqueMaxAcabado)
                      statusTag = { text: 'Físico Alto', style: { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' } };
                  }

                  return (
                    <div key={codigo} style={{ border: `1px solid ${borderColor}`, borderLeft: `4px solid ${borderColor}`, borderRadius: 14, marginBottom: 10, overflow: 'hidden', background: 'white' }}>
                      {/* ── Cabeçalho do card ── */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 14px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--amarelo-claro)', color: 'var(--amarelo)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <i className="ph ph-package"></i>
                          </div>
                          <div>
                            <div style={{ fontWeight: 800, color: 'var(--marrom)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              {produto}
                              {statusTag && <span style={{ fontSize: '0.65rem', padding: '2px 7px', borderRadius: 4, ...statusTag.style }}>{statusTag.text}</span>}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#a78355', fontFamily: 'monospace', marginTop: 1 }}>CÓD: {codigo}</div>
                          </div>
                        </div>
                        {/* Botão ajuste PCP */}
                        {isPcp && (
                          <button
                            onClick={() => setModalAjuste({ fisico: f, winthor: w, codigo, produto })}
                            style={{ background: 'var(--amarelo-claro)', border: '1px solid var(--amarelo)', borderRadius: 8, padding: '6px 12px', fontWeight: 700, fontSize: '0.75rem', color: 'var(--marrom)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            <i className="ph ph-sliders"></i> Ajustar
                          </button>
                        )}
                      </div>

                      {/* ── Painel duplo: Físico | Winthor ── */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderTop: '1px solid #f0e3c4' }}>

                        {/* Físico (entradas da expedição) */}
                        <div style={{ padding: '12px 14px', borderRight: '1px solid #f0e3c4' }}>
                          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#a78355', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <i className="ph ph-snowflake"></i> Físico / Câmara
                          </div>
                          {saldoFisico != null
                            ? <>
                                <div style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--marrom)' }}>
                                  {fmtQtd(saldoFisico, unidade)}
                                </div>
                                {lotesGrp && (
                                  <button
                                    onClick={() => setModalLotesProduto(lotesGrp)}
                                    style={{ marginTop: 6, fontSize: '0.72rem', color: '#a78355', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                  >
                                    {lotesGrp.lotes.length} lote{lotesGrp.lotes.length > 1 ? 's' : ''} →
                                  </button>
                                )}
                              </>
                            : <div style={{ fontSize: '0.82rem', color: '#ccc', fontStyle: 'italic' }}>Sem entrada</div>
                          }
                        </div>

                        {/* Winthor */}
                        <div style={{ padding: '12px 14px' }}>
                          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#a78355', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <i className="ph ph-database"></i> Winthor
                          </div>
                          {w
                            ? <>
                                <div style={{ fontSize: '1.15rem', fontWeight: 900, color: abaixoMin ? '#c0392b' : emAviso ? '#e67e22' : '#3d8b53' }}>
                                  {fmtQtd(w.estoqueAtual, w.unidade)}
                                </div>
                                <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                                  {w.saida24h != null && (
                                    <div style={{ fontSize: '0.72rem' }}>
                                      <span style={{ color: '#a78355', fontWeight: 700 }}>24h </span>
                                      <span style={{ fontWeight: 800, color: 'var(--marrom)' }}>{fmtQtd(w.saida24h, w.unidade)}</span>
                                    </div>
                                  )}
                                  {w.saida48h != null && (
                                    <div style={{ fontSize: '0.72rem' }}>
                                      <span style={{ color: '#a78355', fontWeight: 700 }}>48h </span>
                                      <span style={{ fontWeight: 800, color: 'var(--marrom)' }}>{fmtQtd(w.saida48h, w.unidade)}</span>
                                    </div>
                                  )}
                                  {w.horasAteMinimo != null && isFinite(w.horasAteMinimo) && (
                                    <div style={{ fontSize: '0.72rem' }}>
                                      <span style={{ color: '#a78355', fontWeight: 700 }}>dura </span>
                                      <span style={{ fontWeight: 800, color: abaixoMin ? '#c0392b' : emAviso ? '#e67e22' : '#3d8b53' }}>{fmtHoras(w.horasAteMinimo)}</span>
                                    </div>
                                  )}
                                </div>
                              </>
                            : <div style={{ fontSize: '0.82rem', color: '#ccc', fontStyle: 'italic' }}>Sem dados</div>
                          }
                        </div>
                      </div>

                      {/* Badges de alerta */}
                      {(abaixoMin || emAviso) && (
                        <div style={{ padding: '8px 14px', borderTop: '1px dashed #f0e3c4' }}>
                          {abaixoMin && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fde8e8', color: '#c0392b', fontSize: '0.72rem', fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>
                              <i className="ph ph-warning-circle"></i> Abaixo do mínimo — emitir OP
                            </div>
                          )}
                          {emAviso && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fef3e2', color: '#e67e22', fontSize: '0.72rem', fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>
                              <i className="ph ph-warning"></i> Ruptura em {fmtHoras(w.horasAteMinimo)} — programar OP
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
        )}

        {/* ── ABA: MATÉRIA PRIMA (original preservado) ── */}
        {subAbaEstoque === 'mp' && isPcp && (
          carregandoMP
            ? <div className="status-msg" style={{ fontWeight: 700 }}>Carregando conciliação...</div>
            : mpFiltrado.length === 0
              ? <div className="status-msg">Nenhum item encontrado.</div>
              : <div>
                  {mpFiltrado.map((grp, gIdx) => {
                    const sysQtd = estoqueWinthorSistema[grp.codigo] || 0;
                    const dif = grp.totalFisico - sysQtd;
                    const prodConf = produtos.find(p => p.codigo === grp.codigo || p.nome === grp.nome);
                    let status = null;
                    if (prodConf && (prodConf.estoqueMinMP > 0 || prodConf.estoqueMaxMP > 0)) {
                      if (prodConf.estoqueMinMP > 0 && grp.totalFisico < prodConf.estoqueMinMP) status = { text: 'Baixo', style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' } };
                      else if (prodConf.estoqueMaxMP > 0 && grp.totalFisico > prodConf.estoqueMaxMP) status = { text: 'Alto', style: { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' } };
                      else status = { text: 'Normal', style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' } };
                    }
                    const difPerc = sysQtd > 0 ? ((dif / sysQtd) * 100).toFixed(1) : (dif > 0 ? '100.0' : '0.0');
                    let corStatus, difStr;
                    if      (dif >  0.01) { corStatus = { background: '#fef3c7', color: '#92400e' }; difStr = `+${difPerc}%`; }
                    else if (dif < -0.01) { corStatus = { background: '#fef2f2', color: '#991b1b' }; difStr = `${difPerc}%`; }
                    else                  { corStatus = { background: '#dcfce7', color: '#166534' }; difStr = 'Bateu'; }
                    return (
                      <div key={gIdx} style={{ border: '1px solid var(--border-suave)', borderRadius: 14, marginBottom: 10, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, cursor: 'pointer', background: 'white' }} onClick={() => setModalLotesProduto(grp)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#fff7ed', color: '#ea580c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <i className="ph ph-box-arrow-down"></i>
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                                {grp.nome}
                                {status && <div style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, display: 'inline-block', ...status.style }}>{status.text}</div>}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: '#999', fontFamily: 'monospace', marginTop: 2 }}>CÓD: {grp.codigo}</div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: '0.85rem' }}>
                            <div style={{ textAlign: 'center' }}><div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase' }}>Físico OS</div><div style={{ fontWeight: 700 }}>{grp.totalFisico.toFixed(2)} {grp.und}</div></div>
                            <div style={{ textAlign: 'center' }}><div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase' }}>Winthor</div><div style={{ fontWeight: 700 }}>{sysQtd.toFixed(2)} {grp.und}</div></div>
                            <span style={{ padding: '4px 10px', borderRadius: 20, fontWeight: 700, fontSize: '0.75rem', ...corStatus }}>{difStr}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
        )}
      </div>

      {/* ── Modal Lotes ── */}
      {modalLotesProduto && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', zIndex: 9999 }} onClick={() => setModalLotesProduto(null)}>
          <div style={{ background: 'white', borderRadius: 24, width: '100%', maxWidth: 420, maxHeight: '70vh', overflow: 'hidden', margin: 16 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 20, borderBottom: '1px solid var(--border-suave)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><h2 style={{ fontWeight: 900, fontSize: '1.3rem' }}>{modalLotesProduto.nome}</h2><div style={{ fontSize: '0.75rem', color: '#999' }}>CÓD: {modalLotesProduto.codigo || 'N/A'}</div></div>
              <button style={{ background: 'none', border: 'none', fontSize: '1.4rem', color: '#999', cursor: 'pointer' }} onClick={() => setModalLotesProduto(null)}>✕</button>
            </div>
            <div style={{ padding: 12, maxHeight: '50vh', overflowY: 'auto' }}>
              {(modalLotesProduto.lotes || []).length === 0
                ? <div className="status-msg">Nenhum lote encontrado.</div>
                : (modalLotesProduto.lotes || []).map((lt, lIdx) => (
                    <div key={lIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottom: '1px solid #f3f4f6' }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{lt.lote || lt.loteFisico || lt.batchNumber || lt.code || 'S/N'}</div>
                        <div style={{ fontSize: '0.75rem', color: '#999' }}>{(lt.validade || lt.expiryDate) ? new Date(lt.validade || lt.expiryDate).toLocaleDateString('pt-BR') : 'Sem validade'}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>{parseFloat(lt.qtd || lt.quantity || 0).toFixed(2)}</div>
                        <div style={{ fontSize: '0.75rem', color: '#999' }}>{modalLotesProduto.und || lt.und || 'kg'}</div>
                      </div>
                    </div>
                  ))
              }
            </div>
            <div style={{ padding: 14, background: '#fafafa', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: '#999' }}>Total Físico</span>
              <span style={{ fontWeight: 900, color: 'var(--amarelo)', fontSize: '1.2rem' }}>
                {((modalLotesProduto.totalKg || 0) > 0 ? modalLotesProduto.totalKg.toFixed(2) : (modalLotesProduto.totalUnd || 0) > 0 ? modalLotesProduto.totalUnd : (modalLotesProduto.totalFisico || 0).toFixed(2))} {modalLotesProduto.und || 'kg'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Ajuste Físico PA (só PCP) ── */}
      {modalAjuste && isPcp && (
        <ModalAjusteFisico
          item={{ ...modalAjuste.fisico, codigo: modalAjuste.codigo, produto: modalAjuste.produto }}
          winthorEntry={modalAjuste.winthor}
          aoFechar={() => setModalAjuste(null)}
        />
      )}
    </div>
  );
}
