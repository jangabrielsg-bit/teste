import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { hojeISO, formatarDataBR, formatarKg } from '../services/utils';

export default function PainelTV({ sair }) {
  const dataHoje = hojeISO();
  const [itens, setItens] = useState([]);
  const [existe, setExiste] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [agora, setAgora] = useState(new Date());

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'producaoDiaria', dataHoje), snap => {
      setCarregando(false);
      if (snap.exists()) { setExiste(true); setItens(snap.data().itens || []); }
      else { setExiste(false); setItens([]); }
    });
    return unsub;
  }, [dataHoje]);

  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 1000); return () => clearInterval(t); }, []);

  function alternarTelaCheia() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  function tempoDecorrido(desdeIso) {
    if (!desdeIso) return null;
    const totalSeg = Math.max(0, Math.floor((agora.getTime() - new Date(desdeIso).getTime()) / 1000));
    return `${String(Math.floor(totalSeg / 60)).padStart(2, '0')}:${String(totalSeg % 60).padStart(2, '0')}`;
  }

  function velocidadeMedia(item) {
    const b = item.batidas || [];
    if (b.length < 2) return null;
    return (new Date(b[b.length - 1]).getTime() - new Date(b[0]).getTime()) / 60000 / (b.length - 1);
  }

  const totalProgramado = itens.reduce((s, it) => s + (it.metaLotes || 0), 0);
  const totalFeito = itens.reduce((s, it) => s + (it.feitos || 0), 0);
  const pctGeral = totalProgramado > 0 ? Math.round(totalFeito / totalProgramado * 100) : 0;
  const ordenados = [...itens].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  const itemAtivo = ordenados.find(it => it.feitos < it.metaLotes) || null;

  const porCategoria = {};
  ordenados.forEach(it => { const cat = it.categoria || 'Sem setor'; if (!porCategoria[cat]) porCategoria[cat] = []; porCategoria[cat].push(it); });

  return (
    <div className="tv-shell">
      <div className="tv-topo">
        <div className="tv-data">{formatarDataBR(dataHoje)}</div>
        <div className="tv-relogio">{agora.toLocaleTimeString('pt-BR')}</div>
        <button className="tv-fs-btn" onClick={alternarTelaCheia}>Tela Cheia</button>
        {sair && <button className="tv-fs-btn" onClick={sair} style={{ marginLeft: 10 }}>Voltar</button>}
      </div>

      {carregando && <div className="status-msg" style={{ color: '#d9bd90' }}>Carregando painel...</div>}
      {!carregando && !existe && <div className="tv-vazio">Nenhuma produção programada para hoje.</div>}
      {!carregando && existe && (
        <>
          <div className="tv-resumo">
            <div className="tv-resumo-num">{totalFeito}<span className="tv-resumo-meta"> / {totalProgramado}</span></div>
            <div className="tv-resumo-label">receitas produzidas hoje</div>
            <div className="tv-barra-geral"><div className="tv-barra-geral-fill" style={{ width: pctGeral + '%' }}></div></div>
            <div className="tv-resumo-pct">{pctGeral}%</div>
          </div>

          {itemAtivo ? (
            <div className="tv-ativo">
              <div className="tv-ativo-tag">PRODUZINDO AGORA</div>
              <div className="tv-ativo-nome">{itemAtivo.produto}</div>
              <div className="tv-ativo-setor">{itemAtivo.categoria}</div>
              <div className="tv-ativo-linha">
                <div className="tv-ativo-contagem">{itemAtivo.feitos} <span>/ {itemAtivo.metaLotes} receitas</span></div>
                {itemAtivo.batidas?.length > 0 && (
                  <div className="tv-ativo-cronometro">
                    <div className="tv-cronometro-label">tempo desde a última</div>
                    <div className="tv-cronometro-valor">{tempoDecorrido(itemAtivo.batidas[itemAtivo.batidas.length - 1])}</div>
                  </div>
                )}
                {velocidadeMedia(itemAtivo) != null && (
                  <div className="tv-ativo-velocidade">
                    <div className="tv-cronometro-label">velocidade média</div>
                    <div className="tv-cronometro-valor">{velocidadeMedia(itemAtivo).toFixed(1)} min</div>
                  </div>
                )}
              </div>
              <div className="tv-barra-geral tv-barra-ativo"><div className="tv-barra-geral-fill" style={{ width: Math.min(100, Math.round(itemAtivo.feitos / itemAtivo.metaLotes * 100)) + '%' }}></div></div>
            </div>
          ) : (
            <div className="tv-ativo tv-ativo-concluido">
              <div className="tv-ativo-tag">TUDO CONCLUÍDO</div>
              <div className="tv-ativo-nome">Programação de hoje finalizada 🎉</div>
            </div>
          )}

          <div className="tv-grid-setores">
            {Object.keys(porCategoria).sort().map(cat => (
              <div className="tv-setor-col" key={cat}>
                <div className="tv-setor-titulo">{cat}</div>
                {porCategoria[cat].map((it, i) => {
                  const concluido = it.feitos >= it.metaLotes;
                  const ativo = itemAtivo && it === itemAtivo;
                  return (
                    <div className={'tv-item-row' + (concluido ? ' tv-item-concluido' : '') + (ativo ? ' tv-item-ativo' : '')} key={i}>
                      <span className="tv-item-status">{concluido ? '✔' : ativo ? '●' : '—'}</span>
                      <span className="tv-item-nome">{it.produto}</span>
                      <span className="tv-item-contagem">{it.feitos}/{it.metaLotes}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
