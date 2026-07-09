import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { hojeISO, formatarDataBR, formatarKg } from '../services/utils';

export default function PCP() {
  const dataHoje = hojeISO();
  const [carregando, setCarregando] = useState(true);
  const [registros, setRegistros] = useState([]);
  const [producao, setProducao] = useState({});

  useEffect(() => {
    const unsubExp = onSnapshot(doc(db, 'expedicaoDiaria', dataHoje), snap => {
      if (snap.exists() && snap.data().registros) setRegistros(snap.data().registros);
      else setRegistros([]);
      setCarregando(false);
    });
    const unsubProd = onSnapshot(doc(db, 'producaoDiaria', dataHoje), snap => {
      if (snap.exists() && snap.data().itens) {
        const prodMap = {};
        snap.data().itens.forEach(it => { prodMap[it.codigo] = (it.rendimentoTeorico || 0) * (it.feitos || 0); });
        setProducao(prodMap);
      } else setProducao({});
    });
    return () => { unsubExp(); unsubProd(); };
  }, [dataHoje]);

  if (carregando) return <div className="status-msg">Buscando dados...</div>;

  const agrupado = {};
  registros.forEach(r => {
    const key = r.codigoProduto + '_' + r.lote;
    if (!agrupado[key]) agrupado[key] = { codigoProduto: r.codigoProduto, produto: r.produto, lote: r.lote, ops: r.ops || [], pesoTotal: 0, patinhas: 0 };
    agrupado[key].pesoTotal += r.pesoTotal || r.peso || 0;
    agrupado[key].patinhas += 1;
  });
  const lista = Object.values(agrupado);

  return (
    <div className="container">
      <div className="cat-heading">Entradas Consolidadas ({formatarDataBR(dataHoje)})</div>
      {lista.length === 0 && <div className="status-msg">Nenhuma entrada na câmara hoje.</div>}
      {lista.map((item, idx) => {
        const teorico = producao[item.codigoProduto] || 0;
        let divergenciaPct = 0;
        if (teorico > 0) divergenciaPct = ((item.pesoTotal - teorico) / teorico) * 100;
        const corDiv = divergenciaPct >= 0 ? 'var(--success)' : 'var(--danger)';
        const pctFmt = divergenciaPct > 0 ? '+' + divergenciaPct.toFixed(2) + '%' : divergenciaPct.toFixed(2) + '%';
        return (
          <div className="card" key={idx}>
            <div className="nome" style={{ marginBottom: 8 }}>{item.produto}</div>
            <div className="fechamento-linha"><span style={{ fontWeight: 700, color: 'var(--marrom-claro)' }}>OP Winthor:</span><span>{item.ops.length > 0 ? item.ops.join(', ') : 'N/A'}</span></div>
            <div className="fechamento-linha"><span style={{ fontWeight: 700, color: 'var(--marrom-claro)' }}>Lote Físico:</span><span>{item.lote}</span></div>
            <div className="fechamento-linha" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-suave)' }}>
              <span style={{ fontWeight: 800, color: 'var(--marrom)' }}>PESO TOTAL ({item.patinhas} carros):</span>
              <span style={{ color: 'var(--success)', fontWeight: 900, fontSize: '1.2rem' }}>{formatarKg(item.pesoTotal)} kg</span>
            </div>
            {teorico > 0 && <div className="fechamento-linha"><span style={{ fontWeight: 700, color: 'var(--marrom-claro)' }}>Rendimento Teórico:</span><span style={{ fontWeight: 700 }}>{formatarKg(teorico)} kg</span></div>}
            {teorico > 0 && <div className="fechamento-linha"><span style={{ fontWeight: 700, color: 'var(--marrom-claro)' }}>Divergência:</span><span style={{ color: corDiv, fontWeight: 700 }}>{pctFmt}</span></div>}
          </div>
        );
      })}
    </div>
  );
}
