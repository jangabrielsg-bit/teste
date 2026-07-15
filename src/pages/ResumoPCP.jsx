import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { formatarDataBR } from '../services/utils';

export default function ResumoPCP({ sair }) {
  const [abaAtual, setAbaAtual] = useState(0);
  const [autoRodizio, setAutoRodizio] = useState(false);
  const [dataAlvo, setDataAlvo] = useState(() => new Date().toISOString().split('T')[0]);
  const [prodDiaria, setProdDiaria] = useState([]);
  const [tunel, setTunel] = useState([]);
  const [expedicao, setExpedicao] = useState([]);
  const agora = new Date();

  useEffect(() => {
    let versaoAtual = null;
    const unsub = onSnapshot(doc(db, 'bridge', 'versao'), snap => {
      if (!snap.exists()) return;
      const v = snap.data().valor;
      if (versaoAtual === null) { versaoAtual = v; return; }
      if (v !== versaoAtual) {
        console.log(`🔄 Nova versão detectada (${versaoAtual} → ${v}). Recarregando...`);
        setTimeout(() => window.location.reload(), 2000);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsubProd = onSnapshot(doc(db, 'producaoDiaria', dataAlvo), s => {
      if (s.exists()) { setProdDiaria(s.data().itens || []); setTunel(s.data().tunelRegistros || []); }
      else { setProdDiaria([]); setTunel([]); }
    });
    const unsubExp = onSnapshot(doc(db, 'expedicaoDiaria', dataAlvo), s => {
      if (s.exists() && s.data().registros) setExpedicao([...s.data().registros].reverse());
      else setExpedicao([]);
    });
    return () => { unsubProd(); unsubExp(); };
  }, [dataAlvo]);

  useEffect(() => {
    let interval;
    if (autoRodizio) {
      interval = setInterval(() => {
        setAbaAtual(prev => (prev + 1) % 3);
      }, 30000);
    }
    return () => clearInterval(interval);
  }, [autoRodizio]);

  function toggleFullScreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#3D2515', color: '#D0B29E', fontFamily: "'Inter', sans-serif", overflow: 'hidden' }}>
      {/* Header */}
      <header style={{ height: 80, background: '#2A170A', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', borderBottom: '1px solid #5C3A21', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={import.meta.env.BASE_URL + 'logo.png'} alt="IMAC" style={{ height: 40 }} />
          <h1 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#F6BE00', letterSpacing: 3, textTransform: 'uppercase' }}>Painel Industrial</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', background: '#3D2515', padding: 4, borderRadius: 8, border: '1px solid #734A2A', gap: 4 }}>
            {['Masseira', 'Embaladora', 'Câmaras'].map((txt, i) => (
              <button key={i} onClick={() => { setAbaAtual(i); setAutoRodizio(false); }} style={{ padding: '8px 16px', borderRadius: 4, fontWeight: 700, border: 'none', cursor: 'pointer', background: abaAtual === i ? '#F6BE00' : 'transparent', color: abaAtual === i ? '#2A170A' : '#D0B29E', transition: 'all 0.15s' }}>{txt}</button>
            ))}
            <button onClick={() => setAutoRodizio(!autoRodizio)} style={{ padding: '8px 16px', borderRadius: 4, fontWeight: 700, border: 'none', cursor: 'pointer', background: autoRodizio ? '#10b981' : 'transparent', color: autoRodizio ? '#fff' : '#D0B29E', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s' }}>
              <i className={`ph ${autoRodizio ? 'ph-arrows-clockwise' : 'ph-play'}`}></i>
              Auto 30s
            </button>
          </div>
          <input type="date" style={{ background: '#4A2E1A', color: '#F6BE00', padding: 8, borderRadius: 6, border: '1px solid #734A2A', fontWeight: 700 }} value={dataAlvo} onChange={e => setDataAlvo(e.target.value)} />
          <button onClick={toggleFullScreen} style={{ background: '#F6BE00', color: '#2A170A', padding: '8px 16px', borderRadius: 6, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
            <i className="ph ph-corners-out"></i>
          </button>
          <button onClick={sair} style={{ background: '#4A2E1A', color: 'white', padding: '8px 16px', borderRadius: 6, fontWeight: 700, border: '1px solid #734A2A', cursor: 'pointer' }}>Voltar</button>
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
        {/* Aba 0: Masseira */}
        {abaAtual === 0 && (
          <div>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, textAlign: 'center', color: 'white', marginBottom: 24 }}>
              <i className="ph ph-bowl-food" style={{ color: '#F6BE00', marginRight: 10 }}></i>Produção Masseira
            </h3>
            <div style={{ display: 'grid', gap: 16 }}>
              {prodDiaria.map((item, idx) => {
                const perc = item.metaLotes ? Math.min(100, Math.round(((item.feitos || 0) / item.metaLotes) * 100)) : 0;
                const concluido = (item.feitos || 0) >= item.metaLotes;
                const batidas = item.batidas || [];
                const vel = batidas.length >= 2
                  ? (new Date(batidas.at(-1)).getTime() - new Date(batidas[0]).getTime()) / 60000 / (batidas.length - 1)
                  : null;
                const ub = batidas.at(-1);
                const seg = ub ? Math.max(0, Math.floor((new Date().getTime() - new Date(ub).getTime()) / 1000)) : null;
                const tempoUltima = seg != null ? `${String(Math.floor(seg/60)).padStart(2,'0')}:${String(seg%60).padStart(2,'0')}` : null;
                return (
                  <div key={idx} style={{ background: '#4A2E1A', borderRadius: 16, padding: 20, border: `1px solid ${concluido ? '#15803d' : '#734A2A'}`, borderLeft: `4px solid ${concluido ? '#15803d' : '#F6BE00'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, color: 'white', fontSize: '1.1rem' }}>{item.produto}</div>
                        <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 10 }}>
                          {vel != null && !concluido && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#3D2515', border: '1px solid #734A2A', borderRadius: 20, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, color: '#F6BE00' }}>
                              ⚡ {vel.toFixed(1)} <span style={{ color: '#D0B29E', fontWeight: 400 }}>rec/min</span>
                            </span>
                          )}
                          {tempoUltima && !concluido && (
                            <span style={{ fontSize: '0.72rem', color: '#D0B29E' }}>🕐 há {tempoUltima}</span>
                          )}
                          {concluido && <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4ade80' }}>✔ Concluído</span>}
                        </div>
                      </div>
                      <div style={{ fontFamily: 'monospace', color: '#D0B29E', textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ fontSize: '1.8rem', fontWeight: 900, color: concluido ? '#4ade80' : '#F6BE00' }}>{item.feitos || 0}</span>
                        <span style={{ fontSize: '1rem' }}> / {item.metaLotes}</span>
                      </div>
                    </div>
                    <div style={{ width: '100%', background: '#3D2515', borderRadius: 20, height: 10, overflow: 'hidden' }}>
                      <div style={{ background: concluido ? '#15803d' : '#F6BE00', height: '100%', width: `${perc}%`, transition: 'width 1s' }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Aba 1: Embaladora */}
        {abaAtual === 1 && (
          <div>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, textAlign: 'center', color: 'white', marginBottom: 24 }}>
              <i className="ph ph-package" style={{ color: '#F6BE00', marginRight: 10 }}></i>Fila do Túnel (Embaladora)
            </h3>
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {tunel.map((t, idx) => {
                const [h, m] = t.horaEntrada.split(':').map(Number);
                const totalMin = h * 60 + m + (t.tempo || 35);
                const horaQueda = `${(Math.floor(totalMin / 60) % 24).toString().padStart(2, '0')}:${(totalMin % 60).toString().padStart(2, '0')}`;
                const caindo = Math.abs((agora.getHours() * 60 + agora.getMinutes()) - totalMin) <= 5;
                return (
                  <div key={idx} style={{ background: '#4A2E1A', borderRadius: 16, padding: 20, borderLeft: `4px solid ${caindo ? '#ef4444' : '#F6BE00'}`, boxShadow: caindo ? '0 0 15px rgba(239,68,68,0.5)' : 'none' }}>
                    <div style={{ fontSize: '0.85rem', color: '#D0B29E' }}>Produto</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white', marginBottom: 14 }}>{t.produto}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', background: '#3D2515', padding: 12, borderRadius: 12, border: '1px solid #734A2A' }}>
                      <div><div style={{ fontSize: '0.7rem', color: '#D0B29E', textTransform: 'uppercase' }}>Entrada</div><div style={{ fontFamily: 'monospace', color: 'white' }}>{t.horaEntrada}</div></div>
                      <div style={{ textAlign: 'right' }}><div style={{ fontSize: '0.7rem', color: '#F6BE00', textTransform: 'uppercase', fontWeight: 700 }}>Queda Prevista</div><div style={{ fontFamily: 'monospace', fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>{horaQueda}</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Aba 2: Câmaras */}
        {abaAtual === 2 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'white' }}>
                <i className="ph ph-snowflake" style={{ color: '#F6BE00', marginRight: 10 }}></i>Últimas Entradas nas Câmaras
              </h3>
              <div style={{ background: '#4A2E1A', padding: '12px 24px', borderRadius: 16, border: '1px solid #734A2A', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: '#D0B29E', fontWeight: 700, textTransform: 'uppercase' }}>Peso Total do Dia</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#F6BE00' }}>
                  {expedicao.reduce((acc, e) => acc + (parseFloat(e.pesoTotal) || parseFloat(e.qtd) || 0), 0).toFixed(2).replace('.', ',')} <span style={{ fontSize: '0.8rem', color: '#D0B29E' }}>kg</span>
                </div>
              </div>
            </div>
            <div style={{ background: '#4A2E1A', borderRadius: 16, overflow: 'hidden', border: '1px solid #734A2A' }}>
              <table style={{ width: '100%', textAlign: 'left' }}>
                <thead><tr style={{ background: '#3D2515', color: '#D0B29E' }}>
                  <th style={{ padding: 16, fontWeight: 700 }}>Horário</th>
                  <th style={{ padding: 16, fontWeight: 700 }}>Produto / Lote</th>
                  <th style={{ padding: 16, fontWeight: 700, textAlign: 'right' }}>Peso</th>
                </tr></thead>
                <tbody>
                  {expedicao.slice(0, 10).map((e, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #734A2A' }}>
                      <td style={{ padding: 16, color: '#F6BE00', fontFamily: 'monospace' }}>{e.horario}</td>
                      <td style={{ padding: 16 }}><div style={{ fontWeight: 700, color: 'white' }}>{e.produto}</div><div style={{ fontSize: '0.85rem', color: '#D0B29E' }}>Lote: {e.lote}</div></td>
                      <td style={{ padding: 16, textAlign: 'right', fontWeight: 700, color: 'white' }}>{e.pesoTotal} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
