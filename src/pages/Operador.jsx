import { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc, setDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../services/firebase';
import { hojeISO, paraISO, formatarDataBR } from '../services/utils';

export default function Operador() {
  const [dataAlvo, setDataAlvo] = useState(hojeISO());
  const [carregando, setCarregando] = useState(true);
  const [existe, setExiste] = useState(false);
  const [itens, setItens] = useState([]);
  const [tunelRegistrosDia, setTunelRegistrosDia] = useState([]);
  const [tunelProd, setTunelProd] = useState('');
  const [tunelTempo, setTunelTempo] = useState(35);
  const [tunelHora, setTunelHora] = useState(() => new Date().toTimeString().slice(0, 5));
  const [tunelHoraFim, setTunelHoraFim] = useState(() => { const d = new Date(); d.setMinutes(d.getMinutes() + 35); return d.toTimeString().slice(0, 5); });
  const [salvandoTunel, setSalvandoTunel] = useState(false);

  function mudarDia(delta) { const d = new Date(dataAlvo + 'T12:00:00'); d.setDate(d.getDate() + delta); setDataAlvo(paraISO(d)); }

  useEffect(() => {
    setCarregando(true);
    const unsub = onSnapshot(doc(db, 'producaoDiaria', dataAlvo), (snap) => {
      setCarregando(false);
      if (snap.exists()) {
        setExiste(true);
        setItens(snap.data().itens || []);
        setTunelRegistrosDia(snap.data().tunelRegistros || []);
      } else { setExiste(false); setItens([]); setTunelRegistrosDia([]); }
    });
    return unsub;
  }, [dataAlvo]);

  async function bater(index) {
    const item = itens[index];
    if (item.feitos >= item.metaLotes) return;
    const nova = [...itens];
    nova[index] = { ...nova[index], feitos: nova[index].feitos + 1, batidas: [...(nova[index].batidas || []), new Date().toISOString()] };
    setItens(nova);
    try { await updateDoc(doc(db, 'producaoDiaria', dataAlvo), { itens: nova }); } catch (e) { console.error(e); }
  }

  async function desfazer(index) {
    const item = itens[index];
    if (item.feitos <= 0) return;
    const nova = [...itens];
    const batidas = [...(nova[index].batidas || [])]; batidas.pop();
    nova[index] = { ...nova[index], feitos: Math.max(0, nova[index].feitos - 1), batidas };
    setItens(nova);
    try { await updateDoc(doc(db, 'producaoDiaria', dataAlvo), { itens: nova }); } catch (e) { console.error(e); }
  }

  async function registrarTunel() {
    if (!tunelProd) { alert('Selecione um produto.'); return; }
    const jaExiste = tunelRegistrosDia.find(r => r.produto === tunelProd);
    if (jaExiste) { alert('Produto já registrado no túnel hoje!'); return; }
    setSalvandoTunel(true);
    try {
      const registro = { produto: tunelProd, horaEntrada: tunelHora, horaFim: tunelHoraFim, tempo: parseInt(tunelTempo) || 35, lote: '', timestamp: new Date().toISOString() };
      await setDoc(doc(db, 'producaoDiaria', dataAlvo), { tunelRegistros: arrayUnion(registro) }, { merge: true });
      alert('Entrada no túnel registrada!');
    } catch (e) { alert('Erro: ' + e.message); }
    setSalvandoTunel(false);
  }

  const ativos = [], concluidos = [];
  itens.forEach((item, idx) => { if (item.feitos >= item.metaLotes) concluidos.push({ item, idx }); else ativos.push({ item, idx }); });

  function renderCard({ item, idx }) {
    const concluido = item.feitos >= item.metaLotes;
    const pct = item.metaLotes > 0 ? Math.min(100, Math.round(item.feitos / item.metaLotes * 100)) : 0;
    return (
      <div className={'card' + (concluido ? ' concluido' : '')} key={idx}>
        <div className="card-top">
          <div className="nome">{item.produto}</div>
          {concluido && <span className="selo-ok">Concluído</span>}
        </div>
        <div className="contagem-row">
          <div style={{ flex: 1 }}>
            <span className="contagem-num">{item.feitos}<span className="meta"> / {item.metaLotes}</span></span>
            <div className="progress-bar"><div className="progress-fill" style={{ width: pct + '%' }}></div></div>
          </div>
          <button className="btn-menos" disabled={item.feitos <= 0} onClick={() => desfazer(idx)}>−1</button>
          <button className="btn-mais" disabled={concluido} onClick={() => bater(idx)}>+1</button>
        </div>
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
          <div style={{ fontSize: '0.78rem', color: 'var(--marrom-claro)' }}>Progresso de Produção</div>
          <input type="date" className="input-data" value={dataAlvo} onChange={e => e.target.value && setDataAlvo(e.target.value)} />
        </div>
        <button className="arrow-btn" onClick={() => mudarDia(1)}>›</button>
      </div>

      {carregando ? <div className="status-msg">Carregando...</div> :
       !existe ? <div className="status-msg">Nenhuma produção programada para esta data.<br />Fale com o líder de produção.</div> :
       <>
        {/* Registro Túnel */}
        <div className="card" style={{ borderLeftColor: '#2563eb' }}>
          <div className="nome" style={{ marginBottom: 10, color: '#1e40af' }}>
            <i className="ph ph-thermometer-cold" style={{ marginRight: 6 }}></i>Registro Manual do Túnel Helicoidal
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 4 }}>Produto</label>
              <select className="input-texto" style={{ padding: 10 }} value={tunelProd} onChange={e => setTunelProd(e.target.value)}>
                <option value="">Selecione...</option>
                {itens.map((it, i) => <option key={i} value={it.produto}>{it.produto}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 4 }}>Hora Entrada</label>
              <input type="time" className="input-texto" style={{ padding: 10 }} value={tunelHora} onChange={e => setTunelHora(e.target.value)} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 4 }}>Término Entrada</label>
              <input type="time" className="input-texto" style={{ padding: 10 }} value={tunelHoraFim} onChange={e => setTunelHoraFim(e.target.value)} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 4 }}>Tempo Congel. (min)</label>
              <input type="number" className="input-texto" style={{ padding: 10 }} value={tunelTempo} onChange={e => setTunelTempo(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-block" style={{ marginTop: 12, background: '#2563eb', color: 'white', borderColor: '#2563eb' }} onClick={registrarTunel} disabled={salvandoTunel || !tunelProd}>
            {salvandoTunel ? 'Registrando...' : 'Registrar Entrada no Túnel'}
          </button>
        </div>

        {/* Receitas ativas */}
        {ativos.map(({ item, idx }) => {
          const mostrar = item.categoria !== catAnterior;
          catAnterior = item.categoria;
          return <div key={idx}>{mostrar && <div className="cat-heading">{item.categoria}</div>}{renderCard({ item, idx })}</div>;
        })}
        {ativos.length === 0 && concluidos.length > 0 && <div className="status-msg">Todas as receitas concluídas.</div>}
        {concluidos.length > 0 && <><div className="cat-heading cat-heading-concluidos">Concluídos</div>{concluidos.map(par => renderCard(par))}</>}
       </>
      }
    </div>
  );
}
