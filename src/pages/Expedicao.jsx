import { useState, useEffect } from 'react';
import { doc, onSnapshot, collection, writeBatch, arrayUnion, getDocs, getDoc, increment, setDoc } from 'firebase/firestore';
import { db, dbEstoqueOS } from '../services/firebase';
import { hojeISO, formatarKg } from '../services/utils';
import { useAuth } from '../services/auth';
import { useProdutos } from '../services/hooks';
import ModalTeclado from '../components/ModalTeclado';

export default function Expedicao() {
  const { currentUser } = useAuth();
  const { produtos } = useProdutos();
  const dataHoje = hojeISO();
  const [producaoHoje, setProducaoHoje]     = useState([]);
  const [tunelHoje, setTunelHoje]           = useState([]);
  const [carregando, setCarregando]         = useState(true);
  const [listaEntrada, setListaEntrada]     = useState([]);
  const [salvando, setSalvando]             = useState(false);
  const [produtoIdx, setProdutoIdx]         = useState('');
  const [lote, setLote]                     = useState('');
  const [qtd, setQtd]                       = useState('');
  const [und, setUnd]                       = useState('kg');
  const [validade, setValidade]             = useState('');
  const [nomeOperador, setNomeOperador]     = useState(localStorage.getItem('nomeOperador') || '');
  const [tecladoAberto, setTecladoAberto]   = useState(false);
  const [aba, setAba]                       = useState(0);
  const [estoqueAtual, setEstoqueAtual]     = useState([]);
  const [termoBuscaEstoque, setTermoBuscaEstoque] = useState('');
  const [modalLotesProduto, setModalLotesProduto] = useState(null);
  const [subAbaEstoque, setSubAbaEstoque]   = useState('acabado');
  const [estoqueMP, setEstoqueMP]           = useState([]);
  const [estoqueWinthor, setEstoqueWinthor] = useState({});
  const [carregandoMP, setCarregandoMP]     = useState(false);

  // Matéria Prima (original intacto)
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

  // Produção do dia
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'producaoDiaria', dataHoje), snap => {
      if (snap.exists()) { setProducaoHoje(snap.data().itens || []); setTunelHoje(snap.data().tunelRegistros || []); }
      else { setProducaoHoje([]); setTunelHoje([]); }
      setCarregando(false);
    });
    return unsub;
  }, [dataHoje]);

  // Auto-preenche lote/validade do túnel
  useEffect(() => {
    if (produtoIdx !== '') {
      const itemProg = producaoHoje[produtoIdx];
      if (itemProg) {
        const tunelItem = tunelHoje.slice().reverse().find(t => t.produto === itemProg.produto && t.lote);
        setLote(tunelItem?.lote || '');
        setValidade(tunelItem?.validade || '');
      }
    }
  }, [produtoIdx, producaoHoje, tunelHoje]);

  // Estoque físico PA (coleção 'estoque' — lotes individuais)
  useEffect(() => {
    if (aba === 2) {
      const unsub = onSnapshot(collection(db, 'estoque'), snap => {
        const est = [];
        snap.forEach(d => est.push({ ...d.data(), id: d.id }));
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
    setListaEntrada(prev => [...prev, {
      operador:    nomeOperador.trim(),
      nome:        itemProg.produto,
      codigo:      itemProg.codigo,   // ← código Winthor linkado
      ops:         itemProg.ops || [],
      setor:       itemProg.categoria || 'Câmara',
      dataEntrada: dataHoje,
      lote:        lote.trim(),
      qtd:         parseFloat(qtd),
      und,
      validade,
    }]);
    setQtd('');
    alert('Patinha adicionada para conferência!');
  }

  async function salvarEntradas() {
    if (listaEntrada.length === 0) return;
    setSalvando(true);
    try {
      const batch = writeBatch(db);

      listaEntrada.forEach(item => {
        // ── 1. Lote individual no estoque físico (colecão original) ──
        const refEst = doc(collection(db, 'estoque'));
        batch.set(refEst, {
          nome:        item.nome,
          codigo:      item.codigo,
          setor:       item.setor,
          lote:        item.lote,
          qtd:         item.qtd,
          und:         item.und,
          validade:    item.validade,
          dataEntrada: item.dataEntrada,
          ops:         item.ops,
          isTeste:     false,
        });

        // ── 2. Movimento de entrada (original) ──
        const refMov = doc(collection(db, 'movimentos'));
        batch.set(refMov, {
          tipo:    'ENTRADA',
          nome:    item.nome,
          codigo:  item.codigo,
          lote:    item.lote,
          qtd:     item.qtd,
          und:     item.und,
          data:    new Date().toISOString(),
          usuario: item.operador,
        });

        // ── 3. Expedição diária (original) ──
        const refExp = doc(db, 'expedicaoDiaria', dataHoje);
        const regExp = {
          id:             Date.now().toString() + Math.random(),
          codigoProduto:  item.codigo,
          produto:        item.nome,
          ops:            item.ops,
          lote:           item.lote,
          pesoTotal:      item.qtd,
          qtCaixas:       1,
          horario:        new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
          timestamp:      new Date().toISOString(),
        };
        batch.set(refExp, { data: dataHoje, registros: arrayUnion(regExp) }, { merge: true });

        // ── 4. NOVO: saldo físico PA por código (estoquePAFisico) ──
        // Documento principal: saldo agregado por produto
        if (item.codigo) {
          const refSaldo = doc(db, 'estoquePAFisico', item.codigo);
          batch.set(refSaldo, {
            codigo:       item.codigo,
            produto:      item.nome,
            saldoFisico:  increment(item.qtd),
            unidade:      item.und,
            ultimaEntrada: new Date().toISOString(),
          }, { merge: true });

          // Sub-coleção: lotes individuais rastreáveis
          const refLote = doc(collection(db, 'estoquePAFisico', item.codigo, 'lotes'));
          batch.set(refLote, {
            lote:         item.lote,
            qtd:          item.qtd,
            und:          item.und,
            validade:     item.validade,
            dataEntrada:  item.dataEntrada,
            ops:          item.ops,
            operador:     item.operador,
            ativo:        true,   // false quando consumido/ajustado
            registradoEm: new Date().toISOString(),
          });
        }
      });

      await batch.commit();
      alert(`${listaEntrada.length} patinhas registradas na câmara!`);
      setListaEntrada([]);
      setQtd('');
      setAba(2);
    } catch (e) {
      alert(e.message);
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <div className="status-msg">Buscando produção de hoje...</div>;

  const isPcp = currentUser?.setor === 'pcp';

  // Agrupamento estoque físico acabado
  const gruposAcabado = {};
  estoqueAtual.forEach(it => {
    if (!gruposAcabado[it.nome]) gruposAcabado[it.nome] = { nome: it.nome, codigo: it.codigo, totalKg: 0, totalUnd: 0, lotes: [], und: it.und };
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
              {producaoHoje.map((it, i) => (
                <option key={i} value={i}>
                  {it.produto}{it.codigo ? ` [${it.codigo}]` : ''}
                </option>
              ))}
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
                <option value="kg">kg</option>
                <option value="und">und</option>
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
          {listaEntrada.length === 0
            ? <div className="status-msg">Nenhuma patinha na lista.</div>
            : <div>
                {listaEntrada.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, background: '#fafafa', border: '1px solid var(--border-suave)', borderRadius: 14, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--marrom)' }}>{item.nome}</div>
                      <div style={{ fontSize: '0.78rem', color: '#999', marginTop: 2 }}>
                        Lote: {item.lote} | Val: {item.validade}
                        {item.codigo && <span style={{ marginLeft: 8, background: 'var(--amarelo-claro)', color: 'var(--marrom)', padding: '1px 7px', borderRadius: 8, fontWeight: 700 }}>COD {item.codigo}</span>}
                        {item.ops?.length > 0 && <span style={{ marginLeft: 6, color: '#a78355' }}>OP: {item.ops.join(', ')}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <span style={{ fontWeight: 900, color: 'var(--amarelo)', fontSize: '1.1rem' }}>{formatarKg(item.qtd)} {item.und}</span>
                      <button className="remover-btn" onClick={() => setListaEntrada(prev => prev.filter((_, i) => i !== idx))}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
          }
          {listaEntrada.length > 0 && (
            <button
              className="btn btn-block"
              style={{ marginTop: 14, background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }}
              onClick={salvarEntradas}
              disabled={salvando}
            >
              {salvando ? 'Salvando...' : '✓ Confirmar Entrada na Câmara'}
            </button>
          )}
        </div>
      )}

      {tecladoAberto && (
        <ModalTeclado
          titulo="Peso da Patinha"
          valorInicial={qtd}
          aoConfirmar={v => { setQtd(v); setTecladoAberto(false); }}
          aoFechar={() => setTecladoAberto(false)}
        />
      )}
    </div>
  );
}
