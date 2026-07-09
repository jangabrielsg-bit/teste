import { useState, useEffect } from 'react';
import { doc, onSnapshot, collection, writeBatch, setDoc, arrayUnion, getDocs, getDoc } from 'firebase/firestore';
import { db, dbEstoqueOS } from '../services/firebase';
import { hojeISO, formatarKg } from '../services/utils';
import { useAuth } from '../services/auth';
import ModalTeclado from '../components/ModalTeclado';

export default function Expedicao() {
  const { currentUser } = useAuth();
  const dataHoje = hojeISO();
  const [producaoHoje, setProducaoHoje] = useState([]);
  const [tunelHoje, setTunelHoje] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [listaEntrada, setListaEntrada] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [produtoIdx, setProdutoIdx] = useState('');
  const [lote, setLote] = useState('');
  const [qtd, setQtd] = useState('');
  const [und, setUnd] = useState('kg');
  const [validade, setValidade] = useState('');
  const [nomeOperador, setNomeOperador] = useState(localStorage.getItem('nomeOperador') || '');
  const [tecladoAberto, setTecladoAberto] = useState(false);
  const [aba, setAba] = useState(0);
  const [estoqueAtual, setEstoqueAtual] = useState([]);
  const [termoBuscaEstoque, setTermoBuscaEstoque] = useState('');
  const [modalLotesProduto, setModalLotesProduto] = useState(null);
  const [subAbaEstoque, setSubAbaEstoque] = useState('acabado');
  const [estoqueMP, setEstoqueMP] = useState([]);
  const [estoqueWinthor, setEstoqueWinthor] = useState({});
  const [carregandoMP, setCarregandoMP] = useState(false);

  // Carregar Matéria Prima quando entrar na sub-aba
  useEffect(() => {
    if (aba === 2 && subAbaEstoque === 'mp') {
      (async () => {
        setCarregandoMP(true);
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
  }, [aba, subAbaEstoque]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'producaoDiaria', dataHoje), snap => {
      if (snap.exists()) { setProducaoHoje(snap.data().itens || []); setTunelHoje(snap.data().tunelRegistros || []); }
      else { setProducaoHoje([]); setTunelHoje([]); }
      setCarregando(false);
    });
    return unsub;
  }, [dataHoje]);

  useEffect(() => {
    if (produtoIdx !== '') {
      const itemProg = producaoHoje[produtoIdx];
      if (itemProg) {
        const tunelItem = tunelHoje.slice().reverse().find(t => t.produto === itemProg.produto && t.lote);
        setLote(tunelItem?.lote || ''); setValidade(tunelItem?.validade || '');
      }
    }
  }, [produtoIdx, producaoHoje, tunelHoje]);

  useEffect(() => {
    if (aba === 2) {
      const unsub = onSnapshot(collection(db, 'estoque'), snap => {
        const est = []; snap.forEach(d => est.push({ ...d.data(), id: d.id }));
        setEstoqueAtual(est);
      });
      return unsub;
    }
  }, [aba]);

  function adicionarPatinha() {
    if (produtoIdx === '') return alert('Selecione um produto!');
    if (!qtd || qtd <= 0) return alert('Insira um peso válido!');
    if (!lote.trim()) return alert('Insira o lote físico!');
    if (!nomeOperador.trim()) return alert('Informe seu nome!');
    localStorage.setItem('nomeOperador', nomeOperador.trim());
    const itemProg = producaoHoje[produtoIdx];
    setListaEntrada(prev => [...prev, { operador: nomeOperador.trim(), nome: itemProg.produto, codigo: itemProg.codigo, ops: itemProg.ops || [], setor: itemProg.categoria || 'Câmara', dataEntrada: dataHoje, lote: lote.trim(), qtd: parseFloat(qtd), und, validade }]);
    setQtd('');
    alert('Patinha adicionada para conferência!');
  }

  async function salvarEntradas() {
    if (listaEntrada.length === 0) return;
    setSalvando(true);
    try {
      const batch = writeBatch(db);
      listaEntrada.forEach(item => {
        const refEst = doc(collection(db, 'estoque'));
        batch.set(refEst, { nome: item.nome, setor: item.setor, lote: item.lote, qtd: item.qtd, und: item.und, validade: item.validade, dataEntrada: item.dataEntrada, isTeste: false });
        const refMov = doc(collection(db, 'movimentos'));
        batch.set(refMov, { tipo: 'ENTRADA', nome: item.nome, lote: item.lote, qtd: item.qtd, und: item.und, data: new Date().toISOString(), usuario: 'Expedição (App)' });
        const refExp = doc(db, 'expedicaoDiaria', dataHoje);
        const regExp = { id: Date.now().toString() + Math.random(), codigoProduto: item.codigo, produto: item.nome, ops: item.ops, lote: item.lote, pesoTotal: item.qtd, qtCaixas: 1, horario: new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }), timestamp: new Date().toISOString() };
        batch.set(refExp, { data: dataHoje, registros: arrayUnion(regExp) }, { merge: true });
      });
      await batch.commit();
      alert(`${listaEntrada.length} patinhas registradas!`);
      setListaEntrada([]); setQtd(''); setAba(2);
    } catch (e) { alert(e.message); }
    finally { setSalvando(false); }
  }

  if (carregando) return <div className="status-msg">Buscando produção de hoje...</div>;

  const isPcp = currentUser?.setor === 'pcp';

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
          <i className="ph ph-snowflake" style={{ fontSize: '1.8rem', color: 'var(--amarelo)' }}></i>Expedição / Câmaras
        </h2>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
        <button className={'btn' + (aba === 0 ? ' btn-primary' : ' btn-outline')} onClick={() => setAba(0)} style={{ borderRadius: 50, padding: '8px 20px', whiteSpace: 'nowrap' }}>Pesagem</button>
        <button className={'btn' + (aba === 1 ? ' btn-primary' : ' btn-outline')} onClick={() => setAba(1)} style={{ borderRadius: 50, padding: '8px 20px', whiteSpace: 'nowrap' }}>Conferência ({listaEntrada.length})</button>
        <button className={'btn' + (aba === 2 ? ' btn-primary' : ' btn-outline')} onClick={() => setAba(2)} style={{ borderRadius: 50, padding: '8px 20px', whiteSpace: 'nowrap' }}>Estoque Atual</button>
      </div>

      {/* ── Aba Pesagem ── */}
      {aba === 0 && (
        <div className="card">
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Responsável</label>
            <input className="input-texto" value={nomeOperador} onChange={e => setNomeOperador(e.target.value)} placeholder="Seu nome" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Produto Programado</label>
            <select className="input-texto" value={produtoIdx} onChange={e => setProdutoIdx(e.target.value)} style={{ padding: 14 }}>
              <option value="">Selecione...</option>
              {producaoHoje.map((it, i) => <option key={i} value={i}>{it.produto}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Lote Físico</label>
              <input className="input-texto" value={lote} onChange={e => setLote(e.target.value)} placeholder="Ex: L-0307" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Validade</label>
              <input type="date" className="input-texto" value={validade} onChange={e => setValidade(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--amarelo)', marginBottom: 6 }}>Peso da Patinha</label>
              <button className="input-texto" style={{ textAlign: 'left', fontWeight: 900, fontSize: '1.1rem', padding: 16, border: '2px solid var(--amarelo)', cursor: 'pointer' }} onClick={() => setTecladoAberto(true)}>
                {qtd ? `${formatarKg(qtd)} ${und}` : 'Tocar para digitar peso...'}
              </button>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Unidade</label>
              <select className="input-texto" value={und} onChange={e => setUnd(e.target.value)} style={{ padding: 16 }}>
                <option value="kg">kg</option><option value="und">und</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-block" onClick={adicionarPatinha}>
            <i className="ph ph-plus-circle" style={{ marginRight: 8 }}></i>Adicionar à Conferência
          </button>
        </div>
      )}

      {/* ── Aba Conferência ── */}
      {aba === 1 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 className="nome">Conferência de Patinhas</h3>
            <span style={{ background: 'var(--amarelo-claro)', color: 'var(--marrom)', padding: '6px 14px', borderRadius: 10, fontWeight: 900, fontSize: '0.9rem' }}>
              Total: {listaEntrada.reduce((acc, item) => acc + (item.und === 'kg' ? item.qtd : 0), 0).toFixed(2)} kg
            </span>
          </div>
          {listaEntrada.length === 0 ? <div className="status-msg">Nenhuma patinha na lista.</div> :
            <div>{listaEntrada.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, background: '#fafafa', border: '1px solid var(--border-suave)', borderRadius: 14, marginBottom: 10 }}>
                <div><div style={{ fontWeight: 700, color: 'var(--marrom)' }}>{item.nome}</div><div style={{ fontSize: '0.8rem', color: '#999' }}>Lote: {item.lote} | Val: {item.validade}</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ fontWeight: 900, color: 'var(--amarelo)', fontSize: '1.1rem' }}>{formatarKg(item.qtd)} {item.und}</span>
                  <button className="remover-btn" onClick={() => setListaEntrada(prev => prev.filter((_, i) => i !== idx))}>✕</button>
                </div>
              </div>
            ))}</div>}
          {listaEntrada.length > 0 && <button className="btn btn-block" style={{ marginTop: 14, background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} onClick={salvarEntradas} disabled={salvando}>
            {salvando ? 'Salvando...' : '✓ Confirmar Entrada na Câmara'}
          </button>}
        </div>
      )}

      {/* ── Aba Estoque ── */}
      {aba === 2 && (
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
            <div>{listaAcabado.map((grp, gIdx) => (
              <div key={gIdx} style={{ border: '1px solid var(--border-suave)', borderRadius: 14, marginBottom: 10, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, cursor: 'pointer', background: 'white' }} onClick={() => setModalLotesProduto(grp)}>
                  <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--amarelo-claro)', color: 'var(--amarelo)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i className="ph ph-package"></i>
                    </div>
                    {grp.nome}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {grp.totalKg > 0 && <span style={{ background: 'var(--amarelo-claro)', color: 'var(--marrom)', padding: '4px 10px', borderRadius: 20, fontWeight: 900, fontSize: '0.85rem' }}>{grp.totalKg.toFixed(2)} kg</span>}
                    {grp.totalUnd > 0 && <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '4px 10px', borderRadius: 20, fontWeight: 900, fontSize: '0.85rem' }}>{grp.totalUnd} und</span>}
                  </div>
                </div>
              </div>
            ))}</div>
          )}

          {/* Matéria Prima */}
          {subAbaEstoque === 'mp' && isPcp && (
            carregandoMP ? <div className="status-msg" style={{ fontWeight: 700 }}>Carregando conciliação...</div> :
            mpFiltrado.length === 0 ? <div className="status-msg">Nenhum item encontrado.</div> :
            <div>{mpFiltrado.map((grp, gIdx) => {
              const sysQtd = estoqueWinthor[grp.codigo] || 0;
              const dif = grp.totalFisico - sysQtd;
              let corStatus, difStr;
              if (dif > 0.01) { corStatus = { background: '#fef3c7', color: '#92400e' }; difStr = `Físico > Sys (+${dif.toFixed(2)})`; }
              else if (dif < -0.01) { corStatus = { background: '#fef2f2', color: '#991b1b' }; difStr = `Físico < Sys (${dif.toFixed(2)})`; }
              else { corStatus = { background: '#dcfce7', color: '#166534' }; difStr = 'Bateu'; }
              return (
                <div key={gIdx} style={{ border: '1px solid var(--border-suave)', borderRadius: 14, marginBottom: 10, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, cursor: 'pointer', background: 'white' }} onClick={() => setModalLotesProduto(grp)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#fff7ed', color: '#ea580c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <i className="ph ph-box-arrow-down"></i>
                      </div>
                      <div>
                        <div style={{ fontWeight: 700 }}>{grp.nome}</div>
                        <div style={{ fontSize: '0.7rem', color: '#999', fontFamily: 'monospace' }}>CÓD: {grp.codigo}</div>
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
      )}

      {/* Modal Lotes */}
      {modalLotesProduto && (
        <div className="modal-fundo" style={{ alignItems: 'center', background: 'rgba(0,0,0,0.5)' }} onClick={() => setModalLotesProduto(null)}>
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
                    <div style={{ fontWeight: 700 }}>{lt.lote || lt.loteFisico || lt.batchNumber || 'S/N'}</div>
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

      {tecladoAberto && <ModalTeclado titulo="Peso da Patinha" valorInicial={qtd} aoConfirmar={v => { setQtd(v); setTecladoAberto(false); }} aoFechar={() => setTecladoAberto(false)} />}
    </div>
  );
}
