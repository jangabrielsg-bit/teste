import { useState, useEffect } from 'react';
import { doc, collection, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { hojeISO, formatarDataBR } from '../services/utils';

export default function PainelTV({ sair }) {
  const dataHoje = hojeISO();
  const [itens, setItens] = useState([]);
  const [existe, setExiste] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [agora, setAgora] = useState(new Date());
  const [abaTV, setAbaTV] = useState('producao'); // 'producao' | 'estoque'
  const [estoquePA, setEstoquePA] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'producaoDiaria', dataHoje), snap => {
      setCarregando(false);
      if (snap.exists()) { setExiste(true); setItens(snap.data().itens || []); }
      else { setExiste(false); setItens([]); }
    });
    return unsub;
  }, [dataHoje]);

  // Só escuta estoquePA quando a aba está ativa — economiza leituras
  useEffect(() => {
    if (abaTV !== 'estoque') return;
    const unsub = onSnapshot(collection(db, 'estoquePA'), snap => {
      const lista = [];
      snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
      lista.sort((a, b) => {
        const critA = a.estoqueMinimo > 0 && a.estoqueAtual <= a.estoqueMinimo ? 0 : 1;
        const critB = b.estoqueMinimo > 0 && b.estoqueAtual <= b.estoqueMinimo ? 0 : 1;
        if (critA !== critB) return critA - critB;
        return (a.produto || '').localeCompare(b.produto || '', 'pt-BR');
      });
      setEstoquePA(lista);
    });
    return unsub;
  }, [abaTV]);

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

  // ── Lotes usados na ÚLTIMA batida deste item ──────────────────────
  // Não faz nenhuma leitura extra ao Firestore: o consumoMP[] já vem dentro
  // de producaoDiaria, que o onSnapshot acima já está escutando. Ou seja,
  // isso atualiza sozinho a cada +1 do operador — não precisa esperar o
  // fechamento do dia para ver os lotes na TV.
  function ultimaBatidaMP(item) {
    const historico = item.consumoMP || [];
    if (historico.length === 0) return null;
    return historico[historico.length - 1];
  }

  const totalProgramado = itens.reduce((s, it) => s + (it.metaLotes || 0), 0);
  const totalFeito = itens.reduce((s, it) => s + (it.feitos || 0), 0);
  const pctGeral = totalProgramado > 0 ? Math.round(totalFeito / totalProgramado * 100) : 0;
  const ordenados = [...itens].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  const itemAtivo = ordenados.find(it => it.feitos < it.metaLotes) || null;

  // ── Métricas gerais do dia (todas as receitas, não só o item ativo) ──
  // Junta TODAS as batidas de TODOS os itens num único timeline para achar
  // a última batida do dia inteiro e a velocidade média geral.
  const todasBatidas = itens.flatMap(it => it.batidas || []).sort();
  const ultimaBatidaGeral = todasBatidas.length > 0 ? todasBatidas[todasBatidas.length - 1] : null;
  const velocidadeGeral = (() => {
    if (todasBatidas.length < 2) return null;
    const minutos = (new Date(todasBatidas[todasBatidas.length - 1]).getTime() - new Date(todasBatidas[0]).getTime()) / 60000;
    if (minutos <= 0) return null;
    return (todasBatidas.length - 1) / minutos; // receitas por minuto
  })();

  const porCategoria = {};
  ordenados.forEach(it => { const cat = it.categoria || 'Sem setor'; if (!porCategoria[cat]) porCategoria[cat] = []; porCategoria[cat].push(it); });

  return (
    <div className="tv-shell">
      <div className="tv-topo">
        <div className="tv-data">{formatarDataBR(dataHoje)}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="tv-fs-btn" onClick={() => setAbaTV('producao')} style={{ opacity: abaTV === 'producao' ? 1 : 0.5 }}>Produção</button>
          <button className="tv-fs-btn" onClick={() => setAbaTV('estoque')} style={{ opacity: abaTV === 'estoque' ? 1 : 0.5 }}>Estoque</button>
        </div>
        <div className="tv-relogio">{agora.toLocaleTimeString('pt-BR')}</div>
        <button className="tv-fs-btn" onClick={alternarTelaCheia}>Tela Cheia</button>
        {sair && <button className="tv-fs-btn" onClick={sair} style={{ marginLeft: 10 }}>Voltar</button>}
      </div>

      {/* ── ABA PRODUÇÃO (original) ── */}
      {abaTV === 'producao' && (
        <>
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

              {/* ── Velocidade geral e última batida — todo o dia, não só o item ativo ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
                <div style={{ background: '#1D2530', border: '1px solid #2c3542', borderRadius: 14, padding: '14px 18px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Velocidade geral</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'white', marginTop: 4 }}>
                    {velocidadeGeral != null ? velocidadeGeral.toFixed(2) : '—'}
                    <span style={{ fontSize: '0.9rem', color: '#9ca3af', fontWeight: 700 }}> receitas/min</span>
                  </div>
                </div>
                <div style={{ background: '#1D2530', border: '1px solid #2c3542', borderRadius: 14, padding: '14px 18px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Última receita na masseira</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: ultimaBatidaGeral ? '#4ade80' : '#6b7280', marginTop: 4 }}>
                    {ultimaBatidaGeral ? tempoDecorrido(ultimaBatidaGeral) : '—:—'}
                    {ultimaBatidaGeral && <span style={{ fontSize: '0.9rem', color: '#9ca3af', fontWeight: 700 }}> atrás</span>}
                  </div>
                </div>
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

                  {/* ── Lotes de MP da última batida — atualiza em tempo real ── */}
                  {(() => {
                    const ultima = ultimaBatidaMP(itemAtivo);
                    if (!ultima) return null;
                    return (
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#d9bd90', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                          Lotes em uso — última batida
                          {ultima.incompleto && <span style={{ color: '#f87171', marginLeft: 8 }}>⚠ estoque insuficiente</span>}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                          {(ultima.consumos || []).map((c, i) => (
                            <div key={i} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '6px 12px' }}>
                              <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{c.nomeMP}</div>
                              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'white' }}>
                                {(c.lotes || []).map((l, j) => (
                                  <span key={j} style={{ marginRight: 8 }}>
                                    Lote {l.loteNumero}
                                    {l.forcadoManualmente && <span title="Troca manual do operador" style={{ color: '#fbbf24' }}> ✋</span>}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
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
                      const vel = velocidadeMedia(it);
                      const ultimaBatida = it.batidas?.length > 0 ? it.batidas[it.batidas.length - 1] : null;
                      return (
                        <div className={'tv-item-row' + (concluido ? ' tv-item-concluido' : '') + (ativo ? ' tv-item-ativo' : '')} key={i} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                            <span className="tv-item-status">{concluido ? '✔' : ativo ? '●' : '—'}</span>
                            <span className="tv-item-nome">{it.produto}</span>
                            {it.consumoMP?.length > 0 && (
                              <span title="Matéria-prima rastreada" style={{ fontSize: '0.65rem', marginLeft: 6, opacity: 0.7 }}>📦</span>
                            )}
                            <span className="tv-item-contagem">{it.feitos}/{it.metaLotes}</span>
                          </div>
                          {(vel != null || ultimaBatida) && !concluido && (
                            <div style={{ display: 'flex', gap: 14, fontSize: '0.72rem', color: '#9ca3af', paddingLeft: 22 }}>
                              {vel != null && <span>⚡ {vel.toFixed(1)} min/receita</span>}
                              {ultimaBatida && <span>🕐 há {tempoDecorrido(ultimaBatida)} da última</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── ABA ESTOQUE (nova) ── */}
      {abaTV === 'estoque' && (
        <div style={{ padding: '20px 10px' }}>
          {estoquePA.length === 0 && <div className="tv-vazio">Aguardando dados de estoque...</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {estoquePA.map(item => {
              const abaixoMin = item.estoqueMinimo > 0 && item.estoqueAtual <= item.estoqueMinimo;
              const demanda   = (item.saida24h || 0) + (item.saida48h || 0);

              // Cobertura em dias — usa média real do Winthor se disponível,
              // senão estima pelo saida24h+48h (fallback compatível)
              const coberturaDias = item.coberturaDias ?? (
                item.mediaSaidaDiaria > 0
                  ? item.estoqueAtual / item.mediaSaidaDiaria
                  : demanda > 0 ? (item.estoqueAtual / demanda) * 2 : null
              );

              const emAviso  = !abaixoMin && coberturaDias != null && coberturaDias < 2;
              const corBorda = abaixoMin ? '#e11d48' : emAviso ? '#f59e0b' : '#2c3542';
              const corEstoque = abaixoMin ? '#f87171' : emAviso ? '#fbbf24' : '#4ade80';

              return (
                <div key={item.id} style={{ background: '#1D2530', border: `2px solid ${corBorda}`, borderRadius: 14, padding: 16 }}>
                  <div style={{ fontWeight: 900, color: 'white', fontSize: '1rem', marginBottom: 10 }}>{item.produto}</div>

                  {/* Saldo atual */}
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, color: corEstoque }}>
                    {item.estoqueAtual} <span style={{ fontSize: '0.9rem', color: '#9ca3af' }}>{item.unidade}</span>
                  </div>

                  {/* Métricas de saída */}
                  <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: '0.78rem', color: '#9ca3af', flexWrap: 'wrap' }}>
                    {item.saida24h != null && <span>24h: <b style={{ color: 'white' }}>{item.saida24h}</b></span>}
                    {item.saida48h != null && <span>48h: <b style={{ color: 'white' }}>{item.saida48h}</b></span>}
                    {item.mediaSaidaDiaria > 0 && (
                      <span>Média/dia: <b style={{ color: 'white' }}>{item.mediaSaidaDiaria.toFixed(0)}</b></span>
                    )}
                  </div>

                  {/* Cobertura em dias */}
                  {coberturaDias != null && (
                    <div style={{ marginTop: 10, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>Cobertura</span>
                      <span style={{ fontWeight: 900, color: corEstoque, fontSize: '0.95rem' }}>
                        {coberturaDias < 0.1 ? '< 0.1' : coberturaDias.toFixed(1)} dias
                      </span>
                    </div>
                  )}

                  {/* Rendimento por batida */}
                  {item.rendimentoReal > 0 && (
                    <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#9ca3af' }}>
                      Rendimento: <b style={{ color: 'white' }}>{item.rendimentoReal} {item.unidade}/bat.</b>
                      {item.batidaSemana > 0 && <span> · {item.batidaSemana.toFixed(1)} bat/sem</span>}
                    </div>
                  )}

                  {abaixoMin && (
                    <div style={{ marginTop: 10, background: '#5c1a1a', color: '#f87171', fontWeight: 800, fontSize: '0.75rem', padding: '4px 10px', borderRadius: 20, display: 'inline-block' }}>
                      ABAIXO DO MÍNIMO
                    </div>
                  )}
                  {emAviso && !abaixoMin && (
                    <div style={{ marginTop: 10, background: '#5c3a21', color: '#fbbf24', fontWeight: 800, fontSize: '0.75rem', padding: '4px 10px', borderRadius: 20, display: 'inline-block' }}>
                      COBRE {coberturaDias.toFixed(1)} DIAS
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
