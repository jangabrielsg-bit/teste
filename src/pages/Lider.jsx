import { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc, deleteDoc, collection } from 'firebase/firestore';
import { db } from '../services/firebase';
import { amanhaISO, paraISO, formatarDataBR } from '../services/utils';
import { useProdutos } from '../services/hooks';
import ModalEscolherProduto from '../components/ModalEscolherProduto';

export default function Lider() {
  const [dataAlvo, setDataAlvo] = useState(amanhaISO());
  const { produtos, carregando: carregandoProdutos } = useProdutos();
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [statusRascunho, setStatusRascunho] = useState('');
  const pulaAutosaveRef = useRef(true);

  useEffect(() => {
    setCarregando(true);
    pulaAutosaveRef.current = true;
    (async () => {
      const refConfirmada = doc(db, 'producaoDiaria', dataAlvo);
      const snapConfirmada = await getDoc(refConfirmada);
      if (snapConfirmada.exists() && snapConfirmada.data().itens?.length) {
        setItens(snapConfirmada.data().itens.map(it => ({ ...it })));
        setCarregando(false);
        return;
      }
      const refRascunho = doc(db, 'producaoRascunho', dataAlvo);
      const snapRascunho = await getDoc(refRascunho);
      if (snapRascunho.exists() && snapRascunho.data().itens) {
        setItens(snapRascunho.data().itens.map(it => ({ ...it })));
      } else {
        setItens([]);
      }
      setCarregando(false);
    })();
  }, [dataAlvo]);

  // Autosave rascunho
  useEffect(() => {
    if (carregando) return;
    if (pulaAutosaveRef.current) { pulaAutosaveRef.current = false; return; }
    setStatusRascunho('salvando');
    const t = setTimeout(async () => {
      try {
        const ref = doc(db, 'producaoRascunho', dataAlvo);
        if (itens.length === 0) {
          await deleteDoc(ref).catch(() => {});
        } else {
          await setDoc(ref, { data: dataAlvo, itens, atualizadoEm: new Date().toISOString() });
        }
        setStatusRascunho('salvo');
      } catch { setStatusRascunho(''); }
    }, 700);
    return () => clearTimeout(t);
  }, [itens]);

  function mudarDia(delta) {
    const d = new Date(dataAlvo + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setDataAlvo(paraISO(d));
  }

  function adicionarProduto(produto) {
    setItens(prev => [...prev, {
      codigo: produto.id, produto: produto.nome, categoria: produto.categoria || 'Sem setor',
      metaLotes: 1, ops: [], conferido: false, feitos: 0, batidas: [],
      massaPerdidaProd: 0, massaPerdidaEmb: 0, peDeMassa: 0, rendimentoTeorico: 0, finalizado: false
    }]);
    setModalAberto(false);
  }

  async function importarDoWinthor() {
    setImportando(true);
    try {
      const ref = doc(db, 'winthorSugestoes', dataAlvo);
      const snap = await getDoc(ref);
      if (!snap.exists()) { alert('Nenhuma sugestão do Winthor para ' + formatarDataBR(dataAlvo)); return; }
      const categorias = snap.data().categorias || {};
      let qtdNovos = 0, qtdAtualizados = 0;
      setItens(prev => {
        const lista = [...prev];
        const indicePorCodigo = new Map(lista.map((it, i) => [it.codigo, i]));
        Object.keys(categorias).sort().forEach(cat => {
          categorias[cat].forEach(sug => {
            const idx = indicePorCodigo.get(sug.codigo);
            if (idx != null) {
              const atual = lista[idx];
              if (atual.metaLotes !== sug.metaLotes || atual.rendimentoTeorico !== sug.rendimentoTeorico) {
                lista[idx] = { ...atual, metaLotes: sug.metaLotes, rendimentoTeorico: sug.rendimentoTeorico || 0, ops: sug.ops || [] };
                qtdAtualizados++;
              }
            } else {
              lista.push({ codigo: sug.codigo, produto: sug.produto, categoria: sug.categoria || cat, metaLotes: sug.metaLotes, ops: sug.ops || [], conferido: false, feitos: 0, batidas: [], massaPerdidaProd: 0, massaPerdidaEmb: 0, peDeMassa: 0, rendimentoTeorico: sug.rendimentoTeorico || 0, finalizado: false });
              indicePorCodigo.set(sug.codigo, lista.length - 1);
              qtdNovos++;
            }
          });
        });
        return lista;
      });
      if (qtdNovos === 0 && qtdAtualizados === 0) alert('Lista já está atualizada.');
      else alert(`${qtdNovos} nova(s), ${qtdAtualizados} atualizada(s).`);
    } catch (e) { alert('Erro: ' + e.message); }
    finally { setImportando(false); }
  }

  function removerItem(index) { setItens(prev => prev.filter((_, i) => i !== index)); }
  function moverReal(idxA, idxB) { setItens(prev => { if (idxA < 0 || idxB < 0 || idxA >= prev.length || idxB >= prev.length) return prev; const n = [...prev]; [n[idxA], n[idxB]] = [n[idxB], n[idxA]]; return n; }); }
  function alternarConferido(index) { setItens(prev => { const item = prev[index]; if (!item.conferido) { const sem = prev.filter((_, i) => i !== index); return [...sem, { ...item, conferido: true }]; } const nova = [...prev]; nova[index] = { ...nova[index], conferido: false }; return nova; }); }
  function ajustarMeta(index, delta) { setItens(prev => { const nova = [...prev]; nova[index] = { ...nova[index], metaLotes: Math.max(1, nova[index].metaLotes + delta) }; return nova; }); }
  function arredondarMeta(index) { setItens(prev => { const nova = [...prev]; nova[index] = { ...nova[index], metaLotes: Math.round(nova[index].metaLotes) }; return nova; }); }
  // Ordens de última hora ainda não vêm do Winthor — permite digitar a OP na mão.
  function atualizarOpsManual(index, texto) {
    const ops = texto.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
    setItens(prev => { const nova = [...prev]; nova[index] = { ...nova[index], ops, opsTexto: texto }; return nova; });
  }

  async function confirmarEProgramar() {
    if (itens.length === 0) { alert('Adicione pelo menos uma receita.'); return; }
    setSalvando(true);
    try {
      const itensFinal = itens.map((it, idx) => ({ ...it, ordem: idx }));
      await setDoc(doc(db, 'producaoDiaria', dataAlvo), { data: dataAlvo, confirmadoEm: new Date().toISOString(), itens: itensFinal });
      await deleteDoc(doc(db, 'producaoRascunho', dataAlvo)).catch(() => {});
      alert('Produção de ' + formatarDataBR(dataAlvo) + ' programada!');
    } catch (e) { alert('Erro: ' + e.message); }
    finally { setSalvando(false); }
  }

  if (carregando || carregandoProdutos) return <div className="status-msg">Carregando...</div>;

  const pendentes = [], conferidas = [];
  itens.forEach((item, idx) => { if (item.conferido) conferidas.push({ item, idx }); else pendentes.push({ item, idx }); });

  function renderCard({ item, idx }, pos, total, real) {
    return (
      <div className={'card' + (item.conferido ? ' card-conferida' : '')} key={idx}>
        <div className="reorder-row">
          <div className={'order-num' + (item.conferido ? ' order-num-ok' : '')}>{item.conferido ? '✓' : pos + 1}</div>
          <div style={{ flex: 1 }}>
            <div className="nome">{item.produto}</div>
            <div style={{ margin: '4px 0 8px' }}>
              <input
                className="input-texto"
                style={{ padding: '6px 10px', fontSize: '0.8rem', maxWidth: 220 }}
                value={item.opsTexto ?? (item.ops || []).join(', ')}
                onChange={e => atualizarOpsManual(idx, e.target.value)}
                placeholder="Nº da OP (opcional)"
              />
            </div>
            <div className="meta-stepper">
              <button onClick={() => ajustarMeta(idx, -1)}>−1</button>
              <div className="valor">{item.metaLotes} receita{item.metaLotes === 1 ? '' : 's'}</div>
              <button onClick={() => ajustarMeta(idx, 1)}>+1</button>
              {item.metaLotes % 1 !== 0 && (
                <button onClick={() => arredondarMeta(idx)} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0 12px', marginLeft: 8 }}>
                  ~ Arredondar
                </button>
              )}
            </div>
            <div className="meta-quick">
              <button onClick={() => ajustarMeta(idx, -10)}>−10</button>
              <button onClick={() => ajustarMeta(idx, 10)}>+10</button>
              <button onClick={() => ajustarMeta(idx, 100)}>+100</button>
            </div>
          </div>
          {real && <div className="arrow-col">
            <button className="arrow-btn" disabled={pos === 0} onClick={() => moverReal(idx, pendentes[pos - 1]?.idx)}>↑</button>
            <button className="arrow-btn" disabled={pos === total - 1} onClick={() => moverReal(idx, pendentes[pos + 1]?.idx)}>↓</button>
          </div>}
          <button className="remover-btn" onClick={() => removerItem(idx)}>✕</button>
        </div>
        <button className={item.conferido ? 'btn-desmarcar' : 'btn-conferir'} onClick={() => alternarConferido(idx)}>
          {item.conferido ? '↺ Desmarcar conferência' : '✓ Conferir (bate com o físico)'}
        </button>
      </div>
    );
  }

  let catAnterior = null;
  return (
    <div className="container">
      <div className="toolbar toolbar-data">
        <button className="arrow-btn" onClick={() => mudarDia(-1)}>‹</button>
        <div className="toolbar-data-centro">
          <div style={{ fontWeight: 800 }}>{formatarDataBR(dataAlvo)}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--marrom-claro)' }}>
            {itens.length} receita(s){statusRascunho === 'salvando' && ' · salvando...'}{statusRascunho === 'salvo' && ' · rascunho salvo'}
          </div>
          <input type="date" className="input-data" value={dataAlvo} onChange={e => e.target.value && setDataAlvo(e.target.value)} />
        </div>
        <button className="arrow-btn" onClick={() => mudarDia(1)}>›</button>
      </div>

      {pendentes.map((par, pos) => {
        const mostrar = par.item.categoria !== catAnterior;
        catAnterior = par.item.categoria;
        return <div key={par.idx}>{mostrar && <div className="cat-heading">{par.item.categoria}</div>}{renderCard(par, pos, pendentes.length, true)}</div>;
      })}
      {pendentes.length === 0 && conferidas.length > 0 && <div className="status-msg">Todas as receitas foram conferidas.</div>}
      {conferidas.length > 0 && <><div className="cat-heading cat-heading-concluidos">Conferidas</div>{conferidas.map((par, pos) => renderCard(par, pos, conferidas.length, false))}</>}

      <button className="btn btn-outline btn-block" disabled={importando} onClick={importarDoWinthor} style={{ marginTop: 14 }}>{importando ? 'Importando...' : '⇩ Importar do Winthor'}</button>
      <button className="btn btn-outline btn-block" onClick={() => setModalAberto(true)} style={{ marginTop: 10 }}>+ Adicionar Receita</button>
      <button className="btn btn-primary btn-block" disabled={salvando} onClick={confirmarEProgramar} style={{ marginTop: 14 }}>{salvando ? 'Salvando...' : 'Confirmar Programação'}</button>

      {modalAberto && <ModalEscolherProduto produtos={produtos} aoEscolher={adicionarProduto} aoFechar={() => setModalAberto(false)} />}
    </div>
  );
}
