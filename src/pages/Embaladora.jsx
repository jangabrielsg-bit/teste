import { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

export default function Embaladora() {
  const sugerirValidade = () => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().split('T')[0]; };
  const [dataAlvo, setDataAlvo] = useState(() => new Date().toISOString().split('T')[0]);
  const [tunel, setTunel] = useState([]);
  const [aba, setAba] = useState(0);
  const [editando, setEditando] = useState(null);
  const [formLote, setFormLote] = useState('');
  const [formValidade, setFormValidade] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'producaoDiaria', dataAlvo), (snap) => {
      if (snap.exists() && snap.data().tunelRegistros) setTunel(snap.data().tunelRegistros);
      else setTunel([]);
    });
    return unsub;
  }, [dataAlvo]);

  const agora = new Date();
  const tempoAtual = agora.getHours() * 60 + agora.getMinutes();

  const registrosProcessados = tunel.map((t, idx) => {
    const [h, m] = t.horaEntrada.split(':').map(Number);
    const inicio = h * 60 + m;
    const fim = inicio + (t.tempo || 35);
    const horaFim = `${(Math.floor(fim / 60) % 24).toString().padStart(2, '0')}:${(fim % 60).toString().padStart(2, '0')}`;
    let status = 0;
    if (fim - tempoAtual <= 5) status = 1;
    return { ...t, inicioMin: inicio, fimMin: fim, horaFim, status, originalIndex: idx };
  }).sort((a, b) => a.inicioMin - b.inicioMin);

  let embalandoIndex = -1;
  for (let i = registrosProcessados.length - 1; i >= 0; i--) {
    if (registrosProcessados[i].status === 1) { embalandoIndex = i; break; }
  }

  async function salvarEdicaoLote(idxOriginal) {
    const novaLista = [...tunel];
    novaLista[idxOriginal].lote = formLote;
    novaLista[idxOriginal].validade = formValidade;
    await updateDoc(doc(db, 'producaoDiaria', dataAlvo), { tunelRegistros: novaLista });
    setEditando(null);
  }

  return (
    <div style={{ padding: '16px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid var(--border-suave)' }}>
        <h2 style={{ fontWeight: 900, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="ph ph-package" style={{ fontSize: '1.8rem' }}></i>Embaladora
        </h2>
        <input type="date" className="input-texto" style={{ width: 'auto', padding: '8px 12px' }} value={dataAlvo} onChange={e => setDataAlvo(e.target.value)} />
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <button className={'btn' + (aba === 0 ? ' btn-primary' : ' btn-outline')} onClick={() => setAba(0)} style={{ borderRadius: 50, padding: '8px 24px' }}>Painel (Timeline)</button>
        <button className={'btn' + (aba === 1 ? ' btn-primary' : ' btn-outline')} onClick={() => setAba(1)} style={{ borderRadius: 50, padding: '8px 24px' }}>Gestão de Lotes</button>
      </div>

      {/* Timeline */}
      {aba === 0 && (
        <div style={{ background: '#151A22', borderRadius: 24, padding: 32, minHeight: '50vh' }}>
          <h3 style={{ color: '#F6BE00', fontWeight: 900, fontSize: '1.1rem', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 2 }}>
            <i className="ph ph-monitor-play" style={{ marginRight: 8 }}></i>Painel do Túnel Helicoidal
          </h3>
          <p style={{ color: '#6b7280', marginBottom: 32 }}>Sequência preditiva do que está vindo da masseira e passando pelo túnel.</p>

          {tunel.length === 0 && <div style={{ color: '#6b7280', textAlign: 'center', padding: '40px 0' }}>Nenhum produto no túnel hoje.</div>}

          <div style={{ position: 'relative', paddingLeft: 32 }}>
            {tunel.length > 0 && <div style={{ position: 'absolute', left: 0, top: 16, bottom: 16, width: 2, background: '#374151' }}></div>}
            {registrosProcessados.map((item, i) => {
              const isEmbalando = i === embalandoIndex;
              const isNext = i > embalandoIndex;
              const tagText = isEmbalando ? 'EMBALANDO AGORA' : (isNext ? 'PRÓXIMO LOTE' : 'JÁ PASSOU');
              const tagBg = isEmbalando ? { background: '#F6BE00', color: '#151A22' } : { background: '#374151', color: '#9ca3af' };
              const borderColor = isEmbalando ? '#F6BE00' : '#374151';
              const dotStyle = isEmbalando ? { background: '#F6BE00', boxShadow: '0 0 10px #F6BE00' } : { background: '#6b7280' };

              return (
                <div key={i} style={{ position: 'relative', marginBottom: 28 }}>
                  <div style={{ position: 'absolute', left: -37, top: 32, width: 14, height: 14, borderRadius: '50%', zIndex: 5, ...dotStyle }}></div>
                  <div style={{ background: '#1D2530', borderRadius: 16, padding: 24, border: `2px solid ${borderColor}` }}>
                    <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 4, fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: 14, ...tagBg }}>{tagText}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                      <h4 style={{ fontSize: '1.4rem', fontWeight: 900, color: 'white' }}>{item.produto}</h4>
                      {item.lote && <span style={{ background: 'black', color: '#F6BE00', padding: '4px 12px', borderRadius: 4, fontWeight: 700, fontSize: '0.85rem', border: '1px solid #374151' }}>Lote {item.lote}</span>}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#151A22', border: '1px solid #374151', borderRadius: 8, padding: '8px 16px', color: '#9ca3af', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        <i className="ph ph-clock" style={{ color: '#F6BE00' }}></i>Início: {item.horaEntrada} — Fim: {item.horaFim}
                      </span>
                      {isEmbalando && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#5C3A21', border: '1px solid #F6BE00', borderRadius: 8, padding: '8px 16px', color: '#F6BE00', fontWeight: 700 }}>
                          <i className="ph ph-hourglass-high" style={{ animation: 'pulse 1.5s ease-in-out infinite' }}></i>
                          Termina de cair em {Math.max(0, item.fimMin - tempoAtual)} min
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Gestão de Lotes */}
      {aba === 1 && (
        <div className="card">
          <h3 className="nome" style={{ marginBottom: 16 }}><i className="ph ph-list-numbers" style={{ marginRight: 8 }}></i>Gestão de Lotes e Validade</h3>
          {tunel.length === 0 ? <div className="status-msg">Nenhum produto no túnel.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: 'var(--marrom)', color: 'white' }}>
                    <th style={{ padding: 12, borderRadius: '8px 0 0 0' }}>Horário</th>
                    <th style={{ padding: 12 }}>Produto</th>
                    <th style={{ padding: 12 }}>Lote</th>
                    <th style={{ padding: 12 }}>Validade</th>
                    <th style={{ padding: 12, borderRadius: '0 8px 0 0', textAlign: 'center' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {tunel.map((t, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-suave)' }}>
                      <td style={{ padding: 10, fontFamily: 'monospace', color: '#666' }}>{t.horaEntrada}</td>
                      <td style={{ padding: 10, fontWeight: 700, color: 'var(--marrom)' }}>{t.produto}</td>
                      <td style={{ padding: 10 }}>
                        {editando === idx ? <input className="input-texto" style={{ padding: 6, width: '100%' }} value={formLote} onChange={e => setFormLote(e.target.value)} /> : <span style={{ background: '#f3f4f6', padding: '4px 10px', borderRadius: 6, fontWeight: 700 }}>{t.lote || 'N/A'}</span>}
                      </td>
                      <td style={{ padding: 10 }}>
                        {editando === idx ? <input type="date" className="input-texto" style={{ padding: 6, width: '100%' }} value={formValidade} onChange={e => setFormValidade(e.target.value)} /> : (t.validade || '-')}
                      </td>
                      <td style={{ padding: 10, textAlign: 'center' }}>
                        {editando === idx ? <button className="btn btn-primary" style={{ padding: '6px 16px', fontSize: '0.85rem' }} onClick={() => salvarEdicaoLote(idx)}>Salvar</button>
                        : <button className="btn btn-outline" style={{ padding: '6px 16px', fontSize: '0.85rem' }} onClick={() => { setEditando(idx); setFormLote(t.lote || ''); setFormValidade(t.validade || sugerirValidade()); }}>Editar</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
