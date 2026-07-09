import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { hojeISO, paraISO, formatarDataBR, formatarKg } from '../services/utils';
import ModalTeclado from '../components/ModalTeclado';

export default function Fechamento() {
  const [dataAlvo, setDataAlvo] = useState(hojeISO());
  const [carregando, setCarregando] = useState(true);
  const [existe, setExiste] = useState(false);
  const [itens, setItens] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [teclado, setTeclado] = useState(null);

  useEffect(() => {
    setCarregando(true);
    (async () => {
      const snap = await getDoc(doc(db, 'producaoDiaria', dataAlvo));
      if (snap.exists() && snap.data().itens) {
        setItens(snap.data().itens.map(it => ({ massaPerdidaProd: 0, massaPerdidaEmb: 0, peDeMassa: 0, finalizado: false, ...it })));
        setExiste(true);
      } else { setItens([]); setExiste(false); }
      setCarregando(false);
    })();
  }, [dataAlvo]);

  function mudarDia(delta) { const d = new Date(dataAlvo + 'T12:00:00'); d.setDate(d.getDate() + delta); setDataAlvo(paraISO(d)); }

  function abrirTeclado(index, campo, titulo) { setTeclado({ index, campo, titulo, valorInicial: itens[index][campo] }); }
  function confirmarTeclado(valor) { setItens(prev => { const nova = [...prev]; nova[teclado.index] = { ...nova[teclado.index], [teclado.campo]: valor }; return nova; }); setTeclado(null); }
  function alternarPeDeMassa(index) { setItens(prev => { const nova = [...prev]; const usou = nova[index].peDeMassa > 0 || nova[index].usouPeDeMassa; nova[index] = { ...nova[index], usouPeDeMassa: !usou, peDeMassa: !usou ? nova[index].peDeMassa : 0 }; return nova; }); }

  async function salvarFechamento() {
    setSalvando(true);
    try {
      await updateDoc(doc(db, 'producaoDiaria', dataAlvo), { itens: itens.map(it => ({ ...it, finalizado: true })) });
      alert('Fechamento de ' + formatarDataBR(dataAlvo) + ' salvo!');
    } catch (e) { alert('Erro: ' + e.message); }
    finally { setSalvando(false); }
  }

  if (carregando) return <div className="status-msg">Carregando...</div>;

  let catAnterior = null;
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

      {!existe && <div className="status-msg">Nenhuma produção programada nesse dia.</div>}
      {existe && itens.map((item, idx) => {
        const mostrarCat = item.categoria !== catAnterior;
        catAnterior = item.categoria;
        const usaPe = item.usouPeDeMassa || item.peDeMassa > 0;
        return (
          <div key={idx}>
            {mostrarCat && <div className="cat-heading">{item.categoria}</div>}
            <div className={'card' + (item.finalizado ? ' concluido' : '')}>
              <div className="card-top">
                <div className="nome">{idx + 1}. {item.produto}</div>
                {item.finalizado && <span className="selo-ok">Salvo</span>}
              </div>
              {item.ops?.length > 0 && <div className="ops-linha">OP{item.ops.length > 1 ? 's' : ''} Winthor: {item.ops.join(', ')}</div>}
              <div className="fechamento-resumo">Programadas: <strong>{item.metaLotes}</strong> · Realizadas: <strong>{item.feitos}</strong></div>
              <div className="fechamento-linha"><span>Massa perdida (produção)</span><button className="valor-pill" onClick={() => abrirTeclado(idx, 'massaPerdidaProd', 'Massa perdida — Produção')}>{formatarKg(item.massaPerdidaProd)} kg</button></div>
              <div className="fechamento-linha"><span>Massa perdida (embalagem)</span><button className="valor-pill" onClick={() => abrirTeclado(idx, 'massaPerdidaEmb', 'Massa perdida — Embalagem')}>{formatarKg(item.massaPerdidaEmb)} kg</button></div>
              <div className="fechamento-linha">
                <span>Pé de massa utilizado</span>
                {usaPe ? <button className="valor-pill" onClick={() => abrirTeclado(idx, 'peDeMassa', 'Pé de massa')}>{formatarKg(item.peDeMassa)} kg</button>
                : <button className="valor-pill valor-pill-vazio" onClick={() => alternarPeDeMassa(idx)}>Não utilizado</button>}
              </div>
              {usaPe && <button className="btn-desfazer" onClick={() => alternarPeDeMassa(idx)}>Marcar como não utilizado</button>}
            </div>
          </div>
        );
      })}
      {existe && <button className="btn btn-primary btn-block" disabled={salvando} onClick={salvarFechamento} style={{ marginTop: 14 }}>{salvando ? 'Salvando...' : 'Salvar Fechamento'}</button>}
      {teclado && <ModalTeclado titulo={teclado.titulo} valorInicial={teclado.valorInicial} aoConfirmar={confirmarTeclado} aoFechar={() => setTeclado(null)} />}
    </div>
  );
}
