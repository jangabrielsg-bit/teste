import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { hojeISO, paraISO, formatarDataBR, formatarKg } from '../services/utils';
import ModalTeclado from '../components/ModalTeclado';

const MOTIVOS_PERDA = ['Massa caiu no chão', 'Erro de operação', 'Falha de maquinário', 'Outros'];

// ── Modal: motivo padronizado antes de digitar o peso da perda ─────
function ModalMotivoPerda({ titulo, aoEscolher, aoFechar }) {
  const [motivoSel, setMotivoSel] = useState(null);
  const [textoOutros, setTextoOutros] = useState('');

  function confirmar() {
    if (!motivoSel) return;
    const motivoFinal = motivoSel === 'Outros' ? textoOutros.trim() : motivoSel;
    if (!motivoFinal) { alert('Descreva o motivo.'); return; }
    aoEscolher(motivoFinal);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }} onClick={aoFechar}>
      <div style={{ background: 'white', width: '100%', maxWidth: 480, margin: '0 auto', borderRadius: '20px 20px 0 0', padding: 22 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--marrom)' }}>{titulo}</div>
          <button onClick={aoFechar} style={{ background: 'none', border: 'none', fontSize: '1.3rem', color: '#999', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {MOTIVOS_PERDA.map(m => (
            <button
              key={m}
              onClick={() => setMotivoSel(m)}
              style={{
                textAlign: 'left', padding: '12px 16px', borderRadius: 12,
                border: motivoSel === m ? '2px solid var(--amarelo-escuro)' : '1px solid var(--border-forte)',
                background: motivoSel === m ? 'var(--amarelo-claro)' : 'white',
                fontWeight: 700, color: 'var(--marrom)', cursor: 'pointer',
              }}
            >
              {m}
            </button>
          ))}
        </div>
        {motivoSel === 'Outros' && (
          <input
            className="input-texto"
            placeholder="Descreva o motivo"
            value={textoOutros}
            onChange={e => setTextoOutros(e.target.value)}
            style={{ marginTop: 12 }}
            autoFocus
          />
        )}
        <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} disabled={!motivoSel} onClick={confirmar}>
          Continuar → informar peso
        </button>
      </div>
    </div>
  );
}

export default function Fechamento() {
  const [dataAlvo, setDataAlvo] = useState(hojeISO());
  const [carregando, setCarregando] = useState(true);
  const [existe, setExiste] = useState(false);
  const [itens, setItens] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [teclado, setTeclado] = useState(null);
  const [seletorMotivo, setSeletorMotivo] = useState(null); // { index, campo, titulo }

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
  function abrirSeletorMotivo(index, campo, titulo) { setSeletorMotivo({ index, campo, titulo }); }
  function escolherMotivoPerda(motivo) {
    const { index, campo, titulo } = seletorMotivo;
    setSeletorMotivo(null);
    setTeclado({ index, campo, titulo, valorInicial: itens[index][campo], motivo });
  }
  function confirmarTeclado(valor) {
    setItens(prev => {
      const nova = [...prev];
      const campoMotivo = teclado.campo + 'Motivo';
      nova[teclado.index] = {
        ...nova[teclado.index],
        [teclado.campo]: valor,
        ...(teclado.motivo ? { [campoMotivo]: teclado.motivo } : {}),
      };
      return nova;
    });
    setTeclado(null);
  }
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
              <div className="fechamento-linha">
                <span>Massa perdida (produção){item.massaPerdidaProdMotivo && <div style={{ fontSize: '0.68rem', color: '#999', fontWeight: 600 }}>{item.massaPerdidaProdMotivo}</div>}</span>
                <button className="valor-pill" onClick={() => abrirSeletorMotivo(idx, 'massaPerdidaProd', 'Massa perdida — Produção')}>{formatarKg(item.massaPerdidaProd)} kg</button>
              </div>
              <div className="fechamento-linha">
                <span>Massa perdida (embalagem){item.massaPerdidaEmbMotivo && <div style={{ fontSize: '0.68rem', color: '#999', fontWeight: 600 }}>{item.massaPerdidaEmbMotivo}</div>}</span>
                <button className="valor-pill" onClick={() => abrirSeletorMotivo(idx, 'massaPerdidaEmb', 'Massa perdida — Embalagem')}>{formatarKg(item.massaPerdidaEmb)} kg</button>
              </div>
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
      {seletorMotivo && (
        <ModalMotivoPerda
          titulo={seletorMotivo.titulo}
          aoEscolher={escolherMotivoPerda}
          aoFechar={() => setSeletorMotivo(null)}
        />
      )}
      {teclado && <ModalTeclado titulo={teclado.titulo} valorInicial={teclado.valorInicial} aoConfirmar={confirmarTeclado} aoFechar={() => setTeclado(null)} />}
    </div>
  );
}
