import { useState, useEffect } from 'react';
import { collection, onSnapshot, getDocs, getDoc, doc } from 'firebase/firestore';
import { db, dbEstoqueOS } from '../services/firebase';
import { useAuth } from '../services/auth';
import { useProdutos } from '../services/hooks';

// ── Hook: Estoque PA do Winthor (coleção populada pela bridge) ────
function useEstoqueWinthorPA() {
  const [dados, setDados] = useState({}); // { [nome_normalizado]: { estoqueAtual, saida24h, saida48h, mediaSaidaDiaria, horasAteMinimo, estoqueMinimo, unidade, codigo } }
  const [atualizadoEm, setAtualizadoEm] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'estoquePA'), snap => {
      const mapa = {};
      let ultima = '';
      snap.forEach(d => {
        const item = d.data();
        // Indexa por nome normalizado E por código para facilitar o match
        const chaveNome = (item.produto || '').toLowerCase().trim();
        const chaveCod  = (item.codigo  || '').toLowerCase().trim();
        const entrada = {
          codigo:           item.codigo,
          produto:          item.produto,
          estoqueAtual:     item.estoqueAtual     ?? null,
          saida24h:         item.saida24h          ?? null,
          saida48h:         item.saida48h          ?? null,
          mediaSaidaDiaria: item.mediaSaidaDiaria  ?? null,
          horasAteMinimo:   item.horasAteMinimo    ?? null,
          estoqueMinimo:    item.estoqueMinimo      ?? 0,
          unidade:          item.unidade            || 'UN',
        };
        if (chaveNome) mapa[chaveNome] = entrada;
        if (chaveCod)  mapa[chaveCod]  = entrada;
        if (item.atualizadoEm && item.atualizadoEm > ultima) ultima = item.atualizadoEm;
      });
      setDados(mapa);
      if (ultima) setAtualizadoEm(ultima);
    });
    return unsub;
  }, []);

  return { dados, atualizadoEm };
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
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

// ── Componente: bloco Winthor dentro do card de produto acabado ───
function InfoWinthorPA({ winthorEntry }) {
  if (!winthorEntry || winthorEntry.estoqueAtual == null) {
    return (
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #f0e3c4', display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="ph ph-cloud-slash" style={{ color: '#ccc', fontSize: '0.9rem' }}></i>
        <span style={{ fontSize: '0.72rem', color: '#ccc', fontWeight: 600 }}>Sem dados Winthor</span>
      </div>
    );
  }

  const { estoqueAtual, saida24h, saida48h, mediaSaidaDiaria, horasAteMinimo, estoqueMinimo, unidade } = winthorEntry;
  const abaixoMin = estoqueMinimo > 0 && estoqueAtual <= estoqueMinimo;
  const alertaAviso = !abaixoMin && horasAteMinimo != null && isFinite(horasAteMinimo) && horasAteMinimo <= 48;

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #f0e3c4' }}>
      {/* Linha de dados Winthor */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Estoque Winthor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#a78355', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Winthor</span>
          <span style={{
            fontSize: '0.82rem', fontWeight: 800,
            color: abaixoMin ? '#c0392b' : alertaAviso ? '#e67e22' : '#3d8b53'
          }}>
            {fmtQtd(estoqueAtual, unidade)}
          </span>
        </div>

        {saida24h != null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#a78355', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Saída 24h</span>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#6b4423' }}>{fmtQtd(saida24h, unidade)}</span>
          </div>
        )}

        {saida48h != null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#a78355', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Saída 48h</span>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#6b4423' }}>{fmtQtd(saida48h, unidade)}</span>
          </div>
        )}

        {mediaSaidaDiaria != null && mediaSaidaDiaria > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#a78355', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Média/dia</span>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#6b4423' }}>{fmtQtd(mediaSaidaDiaria, unidade)}</span>
          </div>
        )}

        {horasAteMinimo != null && isFinite(horasAteMinimo) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#a78355', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Dura até</span>
            <span style={{
              fontSize: '0.82rem', fontWeight: 800,
              color: abaixoMin ? '#c0392b' : alertaAviso ? '#e67e22' : '#3d8b53'
            }}>
              {fmtHoras(horasAteMinimo)}
            </span>
          </div>
        )}
      </div>

      {/* Badge de alerta */}
      {abaixoMin && (
        <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fde8e8', color: '#c0392b', fontSize: '0.72rem', fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>
          <i className="ph ph-warning-circle"></i> Abaixo do mínimo — emitir OP
        </div>
      )}
      {alertaAviso && (
        <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fef3e2', color: '#e67e22', fontSize: '0.72rem', fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>
          <i className="ph ph-warning"></i> Ruptura em {fmtHoras(horasAteMinimo)} — programar OP
        </div>
      )}
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

  const [estoqueWinthorSistema, setEstoqueWinthorSistema] = useState({});
  const [estoqueMP, setEstoqueMP]               = useState([]);
  const [carregandoMP, setCarregandoMP]         = useState(false);

  // Novo: dados Winthor PA em tempo real
  const { dados: winthorPA, atualizadoEm: paAtualizadoEm } = useEstoqueWinthorPA();

  // Estoque acabado (lotes OS)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'estoque'), snap => {
      const est = [];
      snap.forEach(d => est.push({ ...d.data(), id: d.id }));
      setEstoqueAtual(est);
    });
    return unsub;
  }, []);

  // Matéria prima (aba MP — comportamento original intacto)
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
            batS.forEach(b => {
              const bd = b.data();
              const pid = bd.productId || bd.item_id;
              if (!batMap[pid]) batMap[pid] = [];
              if ((bd.quantity || 0) > 0) batMap[pid].push({ id: b.id, ...bd });
            });
            const mpList = [];
            invS.forEach(d => {
              const inv = d.data();
              mpList.push({
                id: d.id,
                codigo: inv.code || d.id,
                nome: inv.name,
                und: inv.unit || 'kg',
                lotes: batMap[d.id] || [],
                totalFisico: (batMap[d.id] || []).reduce((acc, l) => acc + (parseFloat(l.quantity) || 0), 0)
              });
            });
            setEstoqueMP(mpList.sort((a, b) => a.nome.localeCompare(b.nome)));
          }
        } catch (e) { console.error('Erro MP:', e); }
        setCarregandoMP(false);
      })();
    }
  }, [subAbaEstoque, isPcp]);

  // Agrupamento estoque acabado (lotes OS)
  const gruposAcabado = {};
  estoqueAtual.forEach(it => {
    if (!gruposAcabado[it.nome]) gruposAcabado[it.nome] = { nome: it.nome, totalKg: 0, totalUnd: 0, lotes: [], und: it.und };
    if (it.und === 'kg') gruposAcabado[it.nome].totalKg += parseFloat(it.qtd || 0);
    else gruposAcabado[it.nome].totalUnd += parseFloat(it.qtd || 0);
    gruposAcabado[it.nome].lotes.push(it);
  });

  // Merge: adiciona itens do Winthor PA que não têm lote no OS ainda
  // (para mostrar mesmo produtos que não foram lançados no sistema de lotes)
  const gruposAcabadoMerge = { ...gruposAcabado };
  Object.values(winthorPA).forEach(w => {
    const chave = (w.produto || '').toLowerCase().trim();
    if (!chave) return;
    // Evita duplicatas — o match por nome já cobre
    const jaExiste = Object.keys(gruposAcabadoMerge).some(k => k.toLowerCase() === chave);
    if (!jaExiste) {
      gruposAcabadoMerge[w.produto] = { nome: w.produto, totalKg: 0, totalUnd: 0, lotes: [], und: w.unidade, somenteWinthor: true };
    }
  });

  let listaAcabado = Object.values(gruposAcabadoMerge);
  let mpFiltrado   = estoqueMP;

  if (termoBuscaEstoque) {
    const t = termoBuscaEstoque.toLowerCase();
    listaAcabado = listaAcabado.filter(g => g.nome.toLowerCase().includes(t));
    mpFiltrado   = estoqueMP.filter(g => g.nome.toLowerCase().includes(t) || (g.codigo && g.codigo.toLowerCase().includes(t)));
  }

  // Ordena: itens com alerta primeiro
  listaAcabado.sort((a, b) => {
    const wa = winthorPA[a.nome.toLowerCase().trim()] || winthorPA[(a.nome || '').toLowerCase().trim()];
    const wb = winthorPA[b.nome.toLowerCase().trim()] || winthorPA[(b.nome || '').toLowerCase().trim()];
    const nivelA = wa && wa.estoqueAtual != null && wa.estoqueAtual <= (wa.estoqueMinimo || 0) ? 0
      : wa && wa.horasAteMinimo != null && wa.horasAteMinimo <= 48 ? 1 : 2;
    const nivelB = wb && wb.estoqueAtual != null && wb.estoqueAtual <= (wb.estoqueMinimo || 0) ? 0
      : wb && wb.horasAteMinimo != null && wb.horasAteMinimo <= 48 ? 1 : 2;
    if (nivelA !== nivelB) return nivelA - nivelB;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  // Resumo alertas (só PA)
  const totalCriticos = listaAcabado.filter(g => {
    const w = winthorPA[g.nome.toLowerCase().trim()];
    return w && w.estoqueAtual != null && w.estoqueAtual <= (w.estoqueMinimo || 0);
  }).length;
  const totalAvisos = listaAcabado.filter(g => {
    const w = winthorPA[g.nome.toLowerCase().trim()];
    return w && w.estoqueAtual != null && w.estoqueAtual > (w.estoqueMinimo || 0) && w.horasAteMinimo != null && w.horasAteMinimo <= 48;
  }).length;

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid var(--border-suave)' }}>
        <h2 style={{ fontWeight: 900, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="ph ph-package" style={{ fontSize: '1.8rem', color: 'var(--amarelo)' }}></i>Gestão de Estoques
        </h2>
      </div>

      <div className="card">
        {/* Header do painel */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 className="nome">Painel de Estoque</h3>
          {isPcp && (
            <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 8, padding: 4 }}>
              <button
                onClick={() => setSubAbaEstoque('acabado')}
                style={{ padding: '8px 16px', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', border: 'none', cursor: 'pointer', background: subAbaEstoque === 'acabado' ? 'white' : 'transparent', color: subAbaEstoque === 'acabado' ? 'var(--marrom)' : '#999', boxShadow: subAbaEstoque === 'acabado' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                🧊 Produto Acabado
              </button>
              <button
                onClick={() => setSubAbaEstoque('mp')}
                style={{ padding: '8px 16px', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', border: 'none', cursor: 'pointer', background: subAbaEstoque === 'mp' ? 'white' : 'transparent', color: subAbaEstoque === 'mp' ? 'var(--marrom)' : '#999', boxShadow: subAbaEstoque === 'mp' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                📦 Matéria Prima
              </button>
            </div>
          )}
        </div>

        {/* Chips de resumo — só na aba acabado quando há dados Winthor */}
        {subAbaEstoque === 'acabado' && (totalCriticos > 0 || totalAvisos > 0) && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {totalCriticos > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fde8e8', color: '#c0392b', padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.8rem' }}>
                <i className="ph ph-warning-circle"></i> {totalCriticos} crítico{totalCriticos > 1 ? 's' : ''}
              </div>
            )}
            {totalAvisos > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fef3e2', color: '#e67e22', padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.8rem' }}>
                <i className="ph ph-warning"></i> {totalAvisos} aviso{totalAvisos > 1 ? 's' : ''} 48h
              </div>
            )}
            {paAtualizadoEm && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: '#a78355', fontWeight: 600 }}>
                <i className="ph ph-arrows-clockwise"></i> Winthor {horaCurta(paAtualizadoEm)}
              </div>
            )}
          </div>
        )}

        {/* Busca */}
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            className="input-texto"
            placeholder="Buscar por nome ou código..."
            value={termoBuscaEstoque}
            onChange={e => setTermoBuscaEstoque(e.target.value)}
          />
        </div>

        {/* ── ABA: PRODUTO ACABADO ── */}
        {subAbaEstoque === 'acabado' && (
          listaAcabado.length === 0
            ? <div className="status-msg">Nenhum produto encontrado.</div>
            : <div>
                {listaAcabado.map((grp, gIdx) => {
                  const prodConf = produtos.find(p => p.nome === grp.nome);
                  const qtd = grp.und === 'kg' ? grp.totalKg : grp.totalUnd;

                  // Status baseado em config do produto (OS)
                  let status = null;
                  if (prodConf && (prodConf.estoqueMinAcabado > 0 || prodConf.estoqueMaxAcabado > 0)) {
                    if (prodConf.estoqueMinAcabado > 0 && qtd < prodConf.estoqueMinAcabado)
                      status = { text: 'Baixo', style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' } };
                    else if (prodConf.estoqueMaxAcabado > 0 && qtd > prodConf.estoqueMaxAcabado)
                      status = { text: 'Alto', style: { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' } };
                    else
                      status = { text: 'Normal', style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' } };
                  }

                  // Match com dados Winthor PA
                  const wEntry = winthorPA[grp.nome.toLowerCase().trim()];
                  const temAlertaCritico = wEntry && wEntry.estoqueAtual != null && wEntry.estoqueAtual <= (wEntry.estoqueMinimo || 0);
                  const temAlertaAviso   = wEntry && !temAlertaCritico && wEntry.horasAteMinimo != null && wEntry.horasAteMinimo <= 48;

                  // Borda esquerda do card reflete o alerta mais grave
                  const borderColor = temAlertaCritico ? '#c0392b' : temAlertaAviso ? '#e67e22' : 'var(--border-suave)';

                  return (
                    <div key={gIdx} style={{ border: `1px solid ${borderColor}`, borderLeft: `4px solid ${borderColor}`, borderRadius: 14, marginBottom: 10, overflow: 'hidden' }}>
                      <div
                        style={{ padding: 14, cursor: grp.lotes.length > 0 ? 'pointer' : 'default', background: 'white' }}
                        onClick={() => grp.lotes.length > 0 && setModalLotesProduto(grp)}
                      >
                        {/* Linha principal */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--amarelo-claro)', color: 'var(--amarelo)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <i className="ph ph-package"></i>
                            </div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {grp.nome}
                                {grp.lotes.length > 0 && (
                                  <span style={{ fontSize: '0.65rem', color: '#a78355', fontWeight: 600 }}>
                                    {grp.lotes.length} lote{grp.lotes.length > 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                              {status && (
                                <div style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, display: 'inline-block', marginTop: 4, ...status.style }}>
                                  {status.text}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Qtd OS (lotes físicos) */}
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                            {!grp.somenteWinthor && (
                              <>
                                {grp.totalKg  > 0 && <span style={{ background: 'var(--amarelo-claro)', color: 'var(--marrom)', padding: '4px 10px', borderRadius: 20, fontWeight: 900, fontSize: '0.85rem' }}>{grp.totalKg.toFixed(2)} kg</span>}
                                {grp.totalUnd > 0 && <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '4px 10px', borderRadius: 20, fontWeight: 900, fontSize: '0.85rem' }}>{grp.totalUnd} und</span>}
                                {grp.totalKg === 0 && grp.totalUnd === 0 && (
                                  <span style={{ background: '#f3f4f6', color: '#999', padding: '4px 10px', borderRadius: 20, fontWeight: 700, fontSize: '0.85rem' }}>0</span>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Bloco Winthor PA */}
                        <InfoWinthorPA winthorEntry={wEntry} />
                      </div>
                    </div>
                  );
                })}
              </div>
        )}

        {/* ── ABA: MATÉRIA PRIMA (comportamento original 100% preservado) ── */}
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
                      if (prodConf.estoqueMinMP > 0 && grp.totalFisico < prodConf.estoqueMinMP)
                        status = { text: 'Baixo', style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' } };
                      else if (prodConf.estoqueMaxMP > 0 && grp.totalFisico > prodConf.estoqueMaxMP)
                        status = { text: 'Alto', style: { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' } };
                      else
                        status = { text: 'Normal', style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' } };
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
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase' }}>Físico OS</div>
                              <div style={{ fontWeight: 700 }}>{grp.totalFisico.toFixed(2)} {grp.und}</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase' }}>Winthor</div>
                              <div style={{ fontWeight: 700 }}>{sysQtd.toFixed(2)} {grp.und}</div>
                            </div>
                            <span style={{ padding: '4px 10px', borderRadius: 20, fontWeight: 700, fontSize: '0.75rem', ...corStatus }}>{difStr}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
        )}
      </div>

      {/* ── Modal Lotes (original preservado) ── */}
      {modalLotesProduto && (
        <div className="modal-fundo" style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', zIndex: 9999 }} onClick={() => setModalLotesProduto(null)}>
          <div style={{ background: 'white', borderRadius: 24, width: '100%', maxWidth: 420, maxHeight: '70vh', overflow: 'hidden', margin: 16 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 20, borderBottom: '1px solid var(--border-suave)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontWeight: 900, fontSize: '1.3rem' }}>{modalLotesProduto.nome}</h2>
                <div style={{ fontSize: '0.75rem', color: '#999' }}>CÓD: {modalLotesProduto.codigo || 'N/A'}</div>
              </div>
              <button className="remover-btn" onClick={() => setModalLotesProduto(null)}>✕</button>
            </div>
            <div style={{ padding: 12, maxHeight: '50vh', overflowY: 'auto' }}>
              {modalLotesProduto.lotes.length === 0
                ? <div className="status-msg">Nenhum lote encontrado.</div>
                : modalLotesProduto.lotes.map((lt, lIdx) => (
                    <div key={lIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottom: '1px solid #f3f4f6' }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{lt.lote || lt.loteFisico || lt.batchNumber || lt.batch_number || lt.code || lt.number || lt.batch || 'S/N'}</div>
                        <div style={{ fontSize: '0.75rem', color: '#999' }}>
                          {(lt.validade || lt.expiryDate) ? new Date(lt.validade || lt.expiryDate).toLocaleDateString('pt-BR') : 'Sem validade'}
                        </div>
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
                {(modalLotesProduto.totalKg > 0 ? modalLotesProduto.totalKg.toFixed(2) : modalLotesProduto.totalUnd > 0 ? modalLotesProduto.totalUnd : (modalLotesProduto.totalFisico || 0).toFixed(2))} {modalLotesProduto.und || 'kg'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
