import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { hojeISO, paraISO, formatarDataBR, horaCurta } from '../services/utils';

export default function Relatorio() {
  const [data, setData] = useState(hojeISO());
  const [carregando, setCarregando] = useState(true);
  const [itens, setItens] = useState([]);
  const [existe, setExiste] = useState(false);

  useEffect(() => {
    setCarregando(true);
    (async () => {
      const snap = await getDoc(doc(db, 'producaoDiaria', data));
      if (snap.exists() && snap.data().itens) { setItens(snap.data().itens); setExiste(true); }
      else { setItens([]); setExiste(false); }
      setCarregando(false);
    })();
  }, [data]);

  function mudarDia(delta) { const d = new Date(data + 'T12:00:00'); d.setDate(d.getDate() + delta); setData(paraISO(d)); }
  function velocidade(item) { const b = item.batidas || []; if (b.length < 2) return null; return (new Date(b[b.length - 1]).getTime() - new Date(b[0]).getTime()) / 60000 / (b.length - 1); }

  return (
    <div className="container">
      <div className="toolbar">
        <button className="arrow-btn" onClick={() => mudarDia(-1)}>‹</button>
        <div style={{ fontWeight: 800, flex: 1, textAlign: 'center' }}>{formatarDataBR(data)}</div>
        <button className="arrow-btn" onClick={() => mudarDia(1)}>›</button>
      </div>
      {carregando && <div className="status-msg">Carregando relatório...</div>}
      {!carregando && !existe && <div className="status-msg">Nenhuma produção registrada nesse dia.</div>}
      {!carregando && existe && (
        <div className="card">
          {itens.map((item, idx) => {
            const vel = velocidade(item);
            const b = item.batidas || [];
            return (
              <div className="rel-row" key={idx}>
                <div>
                  <div className="rel-nome">{item.produto}</div>
                  <div className="rel-sub">{item.feitos}/{item.metaLotes} receitas{b.length > 0 && <> · {horaCurta(b[0])} → {horaCurta(b[b.length - 1])}</>}</div>
                </div>
                <div className="rel-vel">{vel != null ? <>{vel.toFixed(1)} <span style={{ fontSize: '0.7rem', fontWeight: 'normal' }}>min/receita</span></> : '—'}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
