import { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc, setDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../services/firebase';
import { hojeISO, paraISO, formatarDataBR } from '../services/utils';
import {
  listarLotesDisponiveis,
  definirLoteForcado,
  diagnosticarProduto,
} from '../services/consumoMP';

// ── Modal: troca manual do lote de farinha em uso ─────────────────
function ModalTrocaLote({ info, lotesForcadoAtual, aoConfirmar, aoFechar }) {
  const [lotes, setLotes] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let ativo = true;
    listarLotesDisponiveis(info.productId)
      .then(l => { if (ativo) { setLotes(l); setCarregando(false); } })
      .catch(e => { if (ativo) { setErro(e.message); setCarregando(false); } });
    return () => { ativo = false; };
  }, [info.productId]);

  async function escolher(lote) {
    setSalvando(true);
    setErro(null);
    try { await aoConfirmar(lote); aoFechar(); }
    catch (e) { setErro('Erro ao trocar lote: ' + e.message); }
    finally { setSalvando(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }} onClick={aoFechar}>
      <div style={{ background: 'white', width: '100%', maxWidth: 480, margin: '0 auto', borderRadius: '20px 20px 0 0', padding: 22, maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--marrom)' }}>🌾 Trocar lote — {info.nome}</div>
          <button onClick={aoFechar} style={{ background: 'none', border: 'none', fontSize: '1.3rem', color: '#999', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--marrom-claro)', marginBottom: 16 }}>
          Selecione o saco/lote que está sendo usado agora na masseira. Fica registrado o horário da troca para rastreabilidade.
        </div>

        {erro && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: 12, fontSize: '0.78rem', marginBottom: 12 }}>
            {erro}
          </div>
        )}

        {carregando && <div className="status-msg">Carregando lotes disponíveis...</div>}
        {!carregando && lotes?.length === 0 && (
          <div className="status-msg">
            Nenhum lote com estoque disponível para <strong>{info.nome}</strong>.<br />
            Cadastre a entrada deste insumo no Estoque para visualizá-lo aqui.
          </div>
        )}

        {!carregando && lotes?.map((lote, i) => {
          const numero = lote.batchNumber || lote.code || lote.number || lote.id;
          const ativo = lotesForcadoAtual?.loteId === lote.id;
          const proximoFEFO = i === 0;
          return (
            <button
              key={lote.id}
              onClick={() => escolher(lote)}
              disabled={salvando}
              style={{
                width: '100%', textAlign: 'left', padding: '12px 16px', borderRadius: 12, marginBottom: 8,
                border: ativo ? '2px solid var(--amarelo-escuro)' : '1px solid var(--border-forte)',
                background: ativo ? 'var(--amarelo-claro)' : 'white',
                cursor: salvando ? 'wait' : 'pointer',
                opacity: salvando ? 0.6 : 1,
              }}
            >
              <div style={{ fontWeight: 800, color: 'var(--marrom)', fontSize: '0.92rem' }}>
                Lote {numero}
                {proximoFEFO && !ativo && (
                  <span style={{ marginLeft: 8, fontSize: '0.65rem', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '2px 6px', borderRadius: 6 }}>
                    PRÓXIMO (FEFO)
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--marrom-claro)', marginTop: 2 }}>
                {(lote.quantity ?? 0).toFixed(2)} kg disponível
                {(lote.expiryDate || lote.validade) && <> · validade {lote.expiryDate || lote.validade}</>}
                {ativo && <strong style={{ color: 'var(--amarelo-escuro)' }}> · em uso agora</strong>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
  const [processandoMP, setProcessandoMP] = useState(null);
  const [lotesForcados, setLotesForcados] = useState({});
  const [modalTrocaLote, setModalTrocaLote] = useState(null);
  const [nomeOperador] = useState(() => localStorage.getItem('nomeOperador') || '');

  const [diagPorItem, setDiagPorItem] = useState({});

  function mudarDia(delta) { const d = new Date(dataAlvo + 'T12:00:00'); d.setDate(d.getDate() + delta); setDataAlvo(paraISO(d)); }

  const chaveProdutos = itens.map(it => `${it.codigo || ''}::${it.produto}`).join('|');

  useEffect(() => {
    let ativo = true;
    (async () => {
      const unicos = new Map();
      itens.forEach(it => {
        if (!it.produto) return;
        unicos.set(`${it.codigo || ''}::${it.produto}`, { codigo: it.codigo || null, produto: it.produto });
      });

      const mapa = {};
      for (const { codigo, produto } of unicos.values()) {
        try {
          mapa[produto] = await diagnosticarProduto(produto, codigo);
        } catch (e) {
          mapa[produto] = { ok: false, motivo: 'ERRO', mensagem: 'Falha ao ler a ficha técnica: ' + e.message };
        }
      }
      if (ativo) setDiagPorItem(mapa);
    })();
    return () => { ativo = false; };
  }, [chaveProdutos]);

  useEffect(() => {
    setCarregando(true);
    const unsub = onSnapshot(doc(db, 'producaoDiaria', dataAlvo), (snap) => {
      setCarregando(false);
      if (snap.exists()) {
        setExiste(true);
        setItens(snap.data().itens || []);
        setTunelRegistrosDia(snap.data().tunelRegistros || []);
        setLotesForcados(snap.data().lotesForcados || {});
      } else {
        setExiste(false); setItens([]); setTunelRegistrosDia([]); setLotesForcados({});
      }
    });
    return unsub;
  }, [dataAlvo]);

  async function bater(index) {
    const item = itens[index];
    if (item.feitos >= item.metaLotes) return;
    if (processandoMP === index) return;

    setProcessandoMP(index);

    try {
      const diag = diagPorItem[item.produto];
      const receita = diag?.receita;
      let registroConsumo = null;

      if (!receita) {
        const seguir = window.confirm(
          `⚠️ SEM FICHA TÉCNICA\n\n"${item.produto}" não tem receita cadastrada.\n\n` +
          `Esta batida ficará SEM RASTREABILIDADE de lotes.\n\nRegistrar a produção mesmo assim?`
        );
        if (!seguir) {
          setProcessandoMP(null);
          return;
        }
      } else {
        const farinhas = diag?.farinhas || [];
        const consumosRastreio = farinhas.map(f => {
          const forcado = lotesForcados[f.productId];
          return {
            nomeMP: f.nome,
            lote: forcado ? forcado.loteNumero : 'Automático'
          };
        });

        registroConsumo = {
          timestamp: new Date().toISOString(),
          consumos: consumosRastreio
        };
      }

      const nova = [...itens];
      const consumoMPAnterior = nova[index].consumoMP || [];
      nova[index] = {
        ...nova[index],
        feitos: nova[index].feitos + 1,
        batidas: [...(nova[index].batidas || []), new Date().toISOString()],
        consumoMP: registroConsumo ? [...consumoMPAnterior, registroConsumo] : consumoMPAnterior,
      };
      
      const novaLimpa = JSON.parse(JSON.stringify(nova));
      
      // 1. Atualização Otimista: A tela atualiza na mesma hora para não travar o operador
      setItens(novaLimpa);

      // 2. Tenta forçar a gravação e exige confirmação do Firebase
      try {
        await updateDoc(doc(db, 'producaoDiaria', dataAlvo), { itens: novaLimpa });
      } catch (e) {
        // Se o Firebase recusar (permissão, tamanho, rede), a tela volta atrás e mostra o erro
        setItens([...itens]); 
        console.error("Falha no Firebase:", e);
        alert(`❌ O Firebase recusou o salvamento da batida!\n\nMotivo do erro: ${e.message}\n\nO progresso na tela foi desfeito para garantir consistência.`);
      }

    } catch (e) {
      console.error(e);
      alert('Erro inesperado ao processar a batida: ' + e.message);
    } finally {
      setProcessandoMP(null);
    }
  }

  async function desfazer(index) {
    const item = itens[index];
    if (item.feitos <= 0) return;
    if (processandoMP === index) return;

    setProcessandoMP(index);

    try {
      const nova = [...itens];
      const batidas = [...(nova[index].batidas || [])];
      batidas.pop();

      const consumoMPAtual = [...(nova[index].consumoMP || [])];
      consumoMPAtual.pop();

      nova[index] = { ...nova[index], feitos: Math.max(0, nova[index].feitos - 1), batidas, consumoMP: consumoMPAtual };
      
      const novaLimpa = JSON.parse(JSON.stringify(nova));
      
      // 1. Atualização Otimista
      setItens(novaLimpa);

      // 2. Confirmação com Firebase
      try {
        await updateDoc(doc(db, 'producaoDiaria', dataAlvo), { itens: novaLimpa });
      } catch (e) {
        setItens([...itens]);
        console.error("Falha no Firebase (Estorno):", e);
        alert(`❌ O Firebase recusou o estorno!\n\nMotivo do erro: ${e.message}\n\nA tela foi revertida.`);
      }

    } catch (e) {
      console.error(e);
    } finally {
      setProcessandoMP(null);
    }
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
    const processando = processandoMP === idx;
    const diag = diagPorItem[item.produto];
    const farinhas = diag?.farinhas || [];
    const semRastreio = diag && !diag.receita;

    return (
      <div className={'card' + (concluido ? ' concluido' : '')} key={idx}>
        <div className="card-top">
          <div className="nome">{item.produto}</div>
          {concluido && <span className="selo-ok">Concluído</span>}
        </div>

        {item.ops?.length > 0 && (
          <div style={{ fontSize: '0.7rem', color: 'var(--marrom-claro)', marginTop: -4, marginBottom: 6 }}>
            OP {item.ops.join(', ')}
          </div>
        )}

        <div className="contagem-row">
          <div style={{ flex: 1 }}>
            <span className="contagem-num">{item.feitos}<span className="meta"> / {item.metaLotes}</span></span>
            <div className="progress-bar"><div className="progress-fill" style={{ width: pct + '%' }}></div></div>
          </div>
          <button className="btn-menos" disabled={item.feitos <= 0 || processando} onClick={() => desfazer(idx)}>−1</button>
          <button className="btn-mais" disabled={concluido || processando} onClick={() => bater(idx)}>
            {processando ? <i className="ph ph-circle-notch" style={{ animation: 'spin 0.6s linear infinite' }}></i> : '+1'}
          </button>
        </div>

        {semRastreio && (
          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', fontSize: '0.7rem', color: '#b91c1c', lineHeight: 1.4 }}>
            <strong>⚠️ Sem ficha técnica.</strong> O apontamento será feito sem a rastreabilidade dos lotes de matéria-prima.
            <div style={{ fontSize: '0.65rem', marginTop: 2, opacity: 0.85 }}>{diag.mensagem}</div>
          </div>
        )}

        {diag?.receita && (diag.vinculo === 'nome_parcial' || diag.vinculo === 'nome_assimilado') && (
          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', fontSize: '0.68rem', color: '#92400e', lineHeight: 1.4 }}>
            ⚠️ Ficha técnica <strong>{diag.receita.name}</strong> vinculada por assimilação de nome, não pelo código oficial ({item.codigo || 's/ código'}).
            Recomenda-se cadastrar o código Winthor na receita.
          </div>
        )}

        {item.consumoMP?.length > 0 && (
          <div style={{ fontSize: '0.68rem', color: 'var(--marrom-claro)', marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border-suave)' }}>
            <i className="ph ph-package-check" style={{ marginRight: 4 }}></i>
            Lotes rastreados ({item.consumoMP.length} registro{item.consumoMP.length > 1 ? 's' : ''})
          </div>
        )}

        {farinhas.map(farinha => {
          const forcado = lotesForcados[farinha.productId];
          return (
            <div key={farinha.productId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border-suave)', fontSize: '0.75rem' }}>
              <div style={{ color: 'var(--marrom)', minWidth: 0 }}>
                🌾 <strong>{farinha.nome}</strong>: {forcado ? `Lote ${forcado.loteNumero}` : 'Automático'}
                {forcado?.selecionadoEm && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--marrom-claro)' }}>
                    Trocado às {new Date(forcado.selecionadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    {forcado.selecionadoPor ? ` por ${forcado.selecionadoPor}` : ''}
                  </div>
                )}
              </div>
              <button
                onClick={() => setModalTrocaLote(farinha)}
                style={{ background: 'var(--amarelo-claro)', border: '1px solid var(--amarelo)', borderRadius: 8, padding: '5px 10px', fontWeight: 700, fontSize: '0.7rem', color: 'var(--marrom)', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Trocar lote
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  let catAnterior = null;
  return (
    <div className="container">
      <style>{'@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>
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

        {ativos.map(({ item, idx }) => {
          const mostrar = item.categoria !== catAnterior;
          catAnterior = item.categoria;
          return <div key={idx}>{mostrar && <div className="cat-heading">{item.categoria}</div>}{renderCard({ item, idx })}</div>;
        })}
        {ativos.length === 0 && concluidos.length > 0 && <div className="status-msg">Todas as receitas concluídas.</div>}
        {concluidos.length > 0 && <><div className="cat-heading cat-heading-concluidos">Concluídos</div>{concluidos.map(par => renderCard(par))}</>}
       </>
      }

      {modalTrocaLote && (
        <ModalTrocaLote
          info={modalTrocaLote}
          lotesForcadoAtual={lotesForcados[modalTrocaLote.productId]}
          aoConfirmar={async (lote) => {
            await definirLoteForcado(dataAlvo, modalTrocaLote.productId, lote, nomeOperador);
          }}
          aoFechar={() => setModalTrocaLote(null)}
        />
      )}
    </div>
  );
}
