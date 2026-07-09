import { useState, useEffect } from 'react';
import { collection, onSnapshot, getDocs, getDoc, doc } from 'firebase/firestore';
import { db, dbEstoqueOS } from '../services/firebase';
import { useAuth } from '../services/auth';
import { useProdutos } from '../services/hooks';

export default function Estoque() {
  const { currentUser } = useAuth();
  const { produtos } = useProdutos();
  const isPcp = currentUser?.setor === 'pcp';
  
  const [estoqueAtual, setEstoqueAtual] = useState([]);
  const [termoBuscaEstoque, setTermoBuscaEstoque] = useState('');
  const [subAbaEstoque, setSubAbaEstoque] = useState('acabado');
  const [modalLotesProduto, setModalLotesProduto] = useState(null);

  const [estoqueWinthor, setEstoqueWinthor] = useState({});
  const [estoqueMP, setEstoqueMP] = useState([]);
  const [carregandoMP, setCarregandoMP] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'estoque'), snap => {
      const est = []; snap.forEach(d => est.push({ ...d.data(), id: d.id }));
      setEstoqueAtual(est);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (subAbaEstoque === 'mp' && isPcp) {
      setCarregandoMP(true);
      (async () => {
        try {
          const winRef = await getDocs(collection(db, 'winthorEstoqueSistema'));
          const winthorData = {};
          winRef.forEach(d => { winthorData[d.id] = d.data().saldoWinthor || 0; });
          setEstoqueWinthor(winthorData);

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

  // Agrupamento estoque acabado
  const gruposAcabado = {};
  estoqueAtual.forEach(it => {
    if (!gruposAcabado[it.nome]) gruposAcabado[it.nome] = { nome: it.nome, totalKg: 0, totalUnd: 0, lotes: [], und: it.und };
    if (it.und === 'kg') gruposAcabado[it.nome].totalKg += parseFloat(it.qtd || 0);
    else gruposAcabado[it.nome].totalUnd += parseFloat(it.qtd || 0);
    gruposAcabado[it.nome].lotes.push(it);
  });
  
  let listaAcabado = Object.values(gruposAcabado);
  let mpFiltrado = estoqueMP;
  if (termoBuscaEstoque) {
    const t = termoBuscaEstoque.toLowerCase();
    listaAcabado = listaAcabado.filter(g => g.nome.toLowerCase().includes(t));
    mpFiltrado = estoqueMP.filter(g => g.nome.toLowerCase().includes(t) || (g.codigo && g.codigo.toLowerCase().includes(t)));
  }

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid var(--border-suave)' }}>
        <h2 style={{ fontWeight: 900, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="ph ph-package" style={{ fontSize: '1.8rem', color: 'var(--amarelo)' }}></i>Gestão de Estoques
        </h2>
      </div>

      <div className="card">
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

        <div style={{ marginBottom: 16 }}>
          <input type="text" className="input-texto" placeholder="Buscar por nome ou código..." value={termoBuscaEstoque} onChange={e => setTermoBuscaEstoque(e.target.value)} />
        </div>

        {/* Produto Acabado */}
        {subAbaEstoque === 'acabado' && (listaAcabado.length === 0 ? <div className="status-msg">Nenhum produto encontrado.</div> :
          <div>{listaAcabado.map((grp, gIdx) => {
            const prodConf = produtos.find(p => p.nome === grp.nome);
            const qtd = grp.und === 'kg' ? grp.totalKg : grp.totalUnd;
            let status = null;
            if (prodConf && (prodConf.estoqueMinAcabado > 0 || prodConf.estoqueMaxAcabado > 0)) {
              if (prodConf.estoqueMinAcabado > 0 && qtd < prodConf.estoqueMinAcabado) status = { text: 'Baixo', style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' } };
              else if (prodConf.estoqueMaxAcabado > 0 && qtd > prodConf.estoqueMaxAcabado) status = { text: 'Alto', style: { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' } };
              else status = { text: 'Normal', style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' } };
            }
            return (
            <div key={gIdx} style={{ border: '1px solid var(--border-suave)', borderRadius: 14, marginBottom: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, cursor: 'pointer', background: 'white' }} onClick={() => setModalLotesProduto(grp)}>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--amarelo-claro)', color: 'var(--amarelo)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="ph ph-package"></i>
                  </div>
                  <div>
                    <div>{grp.nome}</div>
                    {status && <div style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, display: 'inline-block', marginTop: 4, ...status.style }}>{status.text}</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {grp.totalKg > 0 && <span style={{ background: 'var(--amarelo-claro)', color: 'var(--marrom)', padding: '4px 10px', borderRadius: 20, fontWeight: 900, fontSize: '0.85rem' }}>{grp.totalKg.toFixed(2)} kg</span>}
                  {grp.totalUnd > 0 && <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '4px 10px', borderRadius: 20, fontWeight: 900, fontSize: '0.85rem' }}>{grp.totalUnd} und</span>}
                </div>
              </div>
            </div>
          )})}</div>
        )}

        {/* Matéria Prima */}
        {subAbaEstoque === 'mp' && isPcp && (
          carregandoMP ? <div className="status-msg" style={{ fontWeight: 700 }}>Carregando conciliação...</div> :
          mpFiltrado.length === 0 ? <div className="status-msg">Nenhum item encontrado.</div> :
          <div>{mpFiltrado.map((grp, gIdx) => {
            const sysQtd = estoqueWinthor[grp.codigo] || 0;
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
            if (dif > 0.01) { corStatus = { background: '#fef3c7', color: '#92400e' }; difStr = `+${difPerc}%`; }
            else if (dif < -0.01) { corStatus = { background: '#fef2f2', color: '#991b1b' }; difStr = `${difPerc}%`; }
            else { corStatus = { background: '#dcfce7', color: '#166534' }; difStr = 'Bateu'; }
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
          })}</div>
        )}
      </div>

      {/* Modal Lotes */}
      {modalLotesProduto && (
        <div className="modal-fundo" style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', zIndex: 9999 }} onClick={() => setModalLotesProduto(null)}>
          <div style={{ background: 'white', borderRadius: 24, width: '100%', maxWidth: 420, maxHeight: '70vh', overflow: 'hidden', margin: 16 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 20, borderBottom: '1px solid var(--border-suave)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><h2 style={{ fontWeight: 900, fontSize: '1.3rem' }}>{modalLotesProduto.nome}</h2><div style={{ fontSize: '0.75rem', color: '#999' }}>CÓD: {modalLotesProduto.codigo || 'N/A'}</div></div>
              <button className="remover-btn" onClick={() => setModalLotesProduto(null)}>✕</button>
            </div>
            <div style={{ padding: 12, maxHeight: '50vh', overflowY: 'auto' }}>
              {modalLotesProduto.lotes.length === 0 ? <div className="status-msg">Nenhum lote encontrado.</div> :
              modalLotesProduto.lotes.map((lt, lIdx) => (
                <div key={lIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottom: '1px solid #f3f4f6' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{lt.lote || lt.loteFisico || lt.batchNumber || lt.batch_number || lt.code || lt.number || lt.batch || 'S/N'}</div>
                    <div style={{ fontSize: '0.75rem', color: '#999' }}>{(lt.validade || lt.expiryDate) ? new Date(lt.validade || lt.expiryDate).toLocaleDateString('pt-BR') : 'Sem validade'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 900, fontSize: '1.1rem' }}>{parseFloat(lt.qtd || lt.quantity || 0).toFixed(2)}</div><div style={{ fontSize: '0.75rem', color: '#999' }}>{modalLotesProduto.und || lt.und || 'kg'}</div></div>
                </div>
              ))}
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
