import { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc, setDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../services/firebase';
import { hojeISO, paraISO, formatarDataBR } from '../services/utils';
import { agoraServidor } from '../services/relogioServidor';
import {
  listarLotesDisponiveis,
  definirLoteForcado,
  diagnosticarProduto,
  registrarLotesUtilizados,
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

// ── Códigos padronizados de parada de linha — tabela oficial da fábrica
// (mesma numeração do quadro fixado no chão de fábrica, pra bater com o
// que os operadores já conhecem de cor).
const CODIGOS_PARADA = [
  // Geral / administrativo
  { codigo: '1',  label: 'DDS - Diálogo de Segurança', categoria: 'Geral' },
  { codigo: '2',  label: '5S', categoria: 'Geral' },
  { codigo: '3',  label: 'Aguardando Manutenção', categoria: 'Geral' },
  { codigo: '4',  label: 'Aguardando Qualidade', categoria: 'Geral' },
  { codigo: '5',  label: 'Exames Médico', categoria: 'Geral' },
  { codigo: '6',  label: 'Falta de EPI', categoria: 'Geral' },
  { codigo: '7',  label: 'Falta de Operador', categoria: 'Geral' },
  { codigo: '8',  label: 'Falta de Programação PCP', categoria: 'Geral' },
  { codigo: '9',  label: 'Teste', categoria: 'Geral' },
  { codigo: '10', label: 'Queda de Energia', categoria: 'Geral' },
  { codigo: '11', label: 'Refeição', categoria: 'Geral' },
  { codigo: '12', label: 'Reunião', categoria: 'Geral' },
  { codigo: '13', label: 'Treinamento', categoria: 'Geral' },
  { codigo: '14', label: 'Limpeza', categoria: 'Geral' },
  { codigo: '16', label: 'Absenteísmo', categoria: 'Geral' },
  { codigo: '40', label: 'Checklist', categoria: 'Geral' },
  // Manutenção / equipamento
  { codigo: '15', label: 'Limpeza Máquina', categoria: 'Manutenção / Equipamento' },
  { codigo: '17', label: 'Temperatura do Túnel', categoria: 'Manutenção / Equipamento' },
  { codigo: '18', label: 'Túnel Bloqueado', categoria: 'Manutenção / Equipamento' },
  { codigo: '19', label: 'Temperatura da Água', categoria: 'Manutenção / Equipamento' },
  { codigo: '20', label: 'Falta de Água', categoria: 'Manutenção / Equipamento' },
  { codigo: '21', label: 'Compressor Desligado', categoria: 'Manutenção / Equipamento' },
  { codigo: '22', label: 'Falha Operacional', categoria: 'Manutenção / Equipamento' },
  { codigo: '24', label: 'Manutenção Corretiva', categoria: 'Manutenção / Equipamento' },
  { codigo: '25', label: 'Máquina em Preventiva', categoria: 'Manutenção / Equipamento' },
  { codigo: '26', label: 'Problema Elétrico/Mecânico', categoria: 'Manutenção / Equipamento' },
  { codigo: '27', label: 'Falha no Painel de Comando', categoria: 'Manutenção / Equipamento' },
  { codigo: '28', label: 'Setup', categoria: 'Manutenção / Equipamento' },
  // Insumos / material
  { codigo: '23', label: 'Falta de Matéria Prima', categoria: 'Insumos / Material' },
  { codigo: '29', label: 'Falta de Carrinho', categoria: 'Insumos / Material' },
  { codigo: '30', label: 'Falta de Tela', categoria: 'Insumos / Material' },
  { codigo: '31', label: 'Falta de Caixa', categoria: 'Insumos / Material' },
  { codigo: '32', label: 'Falta de Paletes', categoria: 'Insumos / Material' },
  { codigo: '33', label: 'Pesando Massa/Recheio', categoria: 'Insumos / Material' },
  { codigo: '34', label: 'Matéria Prima Fora da Especificação', categoria: 'Insumos / Material' },
  { codigo: '35', label: 'Retirar Insumo no Almoxarifado', categoria: 'Insumos / Material' },
  { codigo: '36', label: 'Aguardando Solicitação de Insumo', categoria: 'Insumos / Material' },
  { codigo: '37', label: 'Aguardando Separação de Insumo', categoria: 'Insumos / Material' },
  { codigo: '38', label: 'Aguardando Entrega de Insumo', categoria: 'Insumos / Material' },
  { codigo: '39', label: 'Falta de Insumo', categoria: 'Insumos / Material' },
  // Outros
  { codigo: '41', label: 'Outros', categoria: 'Outros' },
];
const CATEGORIAS_PARADA = ['Geral', 'Manutenção / Equipamento', 'Insumos / Material', 'Outros'];
const CODIGO_OUTROS = '41';

// ── Motivos comuns para finalizar produção antes da meta ───────────
const MOTIVOS_FINALIZACAO = [
  'Falta de matéria-prima',
  'Ordem cancelada / reduzida',
  'Fim do turno / expediente',
  'Problema de qualidade',
  'Outros',
];

// ── Modal: iniciar parada de linha (código padronizado) ────────────
function ModalIniciarParada({ aoConfirmar, aoFechar, salvando }) {
  const [codigoSel, setCodigoSel] = useState(null);
  const [textoOutros, setTextoOutros] = useState('');
  const [busca, setBusca] = useState('');

  function confirmar() {
    if (!codigoSel) return;
    if (codigoSel.codigo === CODIGO_OUTROS && !textoOutros.trim()) { alert('Descreva o motivo.'); return; }
    aoConfirmar(codigoSel, textoOutros.trim());
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = termo
    ? CODIGOS_PARADA.filter(c => c.codigo === termo || c.label.toLowerCase().includes(termo))
    : CODIGOS_PARADA;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }} onClick={aoFechar}>
      <div style={{ background: 'white', width: '100%', maxWidth: 480, margin: '0 auto', borderRadius: '20px 20px 0 0', padding: 22, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
          <div style={{ fontWeight: 900, fontSize: '1.05rem', color: '#dc2626' }}>⏸ Registrar parada de linha</div>
          <button onClick={aoFechar} style={{ background: 'none', border: 'none', fontSize: '1.3rem', color: '#999', cursor: 'pointer' }}>✕</button>
        </div>
        <input
          className="input-texto"
          placeholder="Buscar por nome ou código (ex: 23 ou farinha)"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          style={{ marginBottom: 12, flexShrink: 0 }}
        />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {CATEGORIAS_PARADA.map(cat => {
            const doCategoria = filtrados.filter(c => c.categoria === cat);
            if (doCategoria.length === 0) return null;
            return (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--marrom-claro)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{cat}</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {doCategoria.map(c => (
                    <button
                      key={c.codigo}
                      onClick={() => setCodigoSel(c)}
                      style={{
                        textAlign: 'left', padding: '10px 14px', borderRadius: 12,
                        border: codigoSel?.codigo === c.codigo ? '2px solid #dc2626' : '1px solid var(--border-forte)',
                        background: codigoSel?.codigo === c.codigo ? '#fef2f2' : 'white',
                        fontWeight: 700, color: 'var(--marrom)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}
                    >
                      <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#999', background: '#f3f4f6', borderRadius: 6, padding: '2px 6px', minWidth: 22, textAlign: 'center' }}>{c.codigo}</span>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {filtrados.length === 0 && <div className="status-msg">Nenhum código encontrado.</div>}
        </div>
        {codigoSel?.codigo === CODIGO_OUTROS && (
          <input
            className="input-texto"
            placeholder="Descreva o motivo da parada"
            value={textoOutros}
            onChange={e => setTextoOutros(e.target.value)}
            style={{ marginTop: 12, flexShrink: 0 }}
            autoFocus
          />
        )}
        <button
          className="btn btn-block"
          style={{ marginTop: 12, background: '#dc2626', color: 'white', borderColor: '#dc2626', flexShrink: 0 }}
          disabled={!codigoSel || salvando}
          onClick={confirmar}
        >
          {salvando ? 'Registrando...' : codigoSel ? `Confirmar: [${codigoSel.codigo}] ${codigoSel.label}` : 'Confirmar parada'}
        </button>
      </div>
    </div>
  );
}

// ── Modal: motivo de finalizar produção antes da meta ───────────────
function ModalMotivoFinalizacao({ item, aoConfirmar, aoFechar, salvando }) {
  const [motivoSel, setMotivoSel] = useState(null);
  const [textoOutros, setTextoOutros] = useState('');
  const faltam = item.metaLotes - item.feitos;

  function confirmar() {
    if (!motivoSel) return;
    const motivoFinal = motivoSel === 'Outros' ? textoOutros.trim() : motivoSel;
    if (!motivoFinal) { alert('Descreva o motivo.'); return; }
    aoConfirmar(motivoFinal);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }} onClick={aoFechar}>
      <div style={{ background: 'white', width: '100%', maxWidth: 480, margin: '0 auto', borderRadius: '20px 20px 0 0', padding: 22 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--marrom)' }}>🏁 Finalizar antes da meta</div>
          <button onClick={aoFechar} style={{ background: 'none', border: 'none', fontSize: '1.3rem', color: '#999', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--marrom-claro)', marginBottom: 16 }}>
          {item.produto} — {item.feitos}/{item.metaLotes} (faltam {faltam})
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {MOTIVOS_FINALIZACAO.map(m => (
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
        <button
          className="btn btn-block"
          style={{ marginTop: 18, background: 'var(--marrom)', color: 'white' }}
          disabled={!motivoSel || salvando}
          onClick={confirmar}
        >
          {salvando ? 'Salvando...' : 'Confirmar finalização'}
        </button>
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
  const [registrandoTunel, setRegistrandoTunel] = useState(null); // idx do card com ação de túnel em andamento
  const [processandoMP, setProcessandoMP] = useState(null);
  const [lotesForcados, setLotesForcados] = useState({});
  const [modalTrocaLote, setModalTrocaLote] = useState(null);
  const [nomeOperador] = useState(() => localStorage.getItem('nomeOperador') || '');
  const [paradas, setParadas] = useState([]);
  const [modalParada, setModalParada] = useState(false);
  const [salvandoParada, setSalvandoParada] = useState(false);
  const [modalFinalizar, setModalFinalizar] = useState(null); // { item, idx }
  const [salvandoFinalizar, setSalvandoFinalizar] = useState(false);

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
        setParadas(snap.data().paradas || []);
      } else {
        setExiste(false); setItens([]); setTunelRegistrosDia([]); setLotesForcados({}); setParadas([]);
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
        // Registra (via FEFO) os lotes de TODOS os insumos da receita —
        // farinha, glúten, sal, melhorador etc. — sem descontar nada do
        // estoque físico: a baixa de MP continua manual (Estoque/PVPS).
        // Isto só fecha a rastreabilidade ponta a ponta desta batida.
        try {
          const resultado = await registrarLotesUtilizados(receita, 1, lotesForcados, {
            ops: item.ops || [],
            codigo: item.codigo,
            produto: item.produto,
            operador: nomeOperador || 'Não identificado',
          });
          registroConsumo = {
            timestamp: agoraServidor().toISOString(),
            incompleto: resultado.incompleto,
            ops: resultado.ops,
            consumos: resultado.consumos,
          };
        } catch (e) {
          console.error('Erro ao registrar lotes de MP:', e);
          registroConsumo = { timestamp: agoraServidor().toISOString(), erro: e.message, consumos: [] };
        }
      }

      const nova = [...itens];
      const consumoMPAnterior = nova[index].consumoMP || [];
      nova[index] = {
        ...nova[index],
        feitos: nova[index].feitos + 1,
        batidas: [...(nova[index].batidas || []), agoraServidor().toISOString()],
        consumoMP: registroConsumo ? [...consumoMPAnterior, registroConsumo] : consumoMPAnterior,
      };
      
      const novaLimpa = JSON.parse(JSON.stringify(nova));
      
      // 1. Atualização Otimista: A tela atualiza na mesma hora para não travar o operador
      setItens(novaLimpa);

      // 2. Dispara a gravação em background (não bloqueia a tela se estiver com internet fraca/offline)
      updateDoc(doc(db, 'producaoDiaria', dataAlvo), { itens: novaLimpa })
        .catch(e => {
          console.error("Falha no Firebase:", e);
          alert(`❌ Falha ao sincronizar com Firebase: ${e.message}\n\nVerifique sua conexão.`);
        });

    } catch (e) {
      console.error(e);
      alert('Erro inesperado ao processar a batida: ' + e.message);
    } finally {
      // Libera a tela rapidamente para permitir a próxima batida
      setTimeout(() => setProcessandoMP(null), 400);
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

      // 2. Confirmação com Firebase em background
      updateDoc(doc(db, 'producaoDiaria', dataAlvo), { itens: novaLimpa })
        .catch(e => {
          console.error("Falha no Firebase (Estorno):", e);
          alert(`❌ Falha ao estornar na nuvem: ${e.message}\n\nVerifique sua conexão.`);
        });

    } catch (e) {
      console.error(e);
    } finally {
      // Libera a tela rapidamente para permitir a próxima batida
      setTimeout(() => setProcessandoMP(null), 400);
    }
  }

  // Entrada no túnel — botão aparece no card assim que a 1ª receita é batida (+1)
  async function registrarEntradaTunel(item, idx) {
    if (tunelRegistrosDia.find(r => r.produto === item.produto)) return;
    const tempoStr = window.prompt(`Tempo de congelamento (min) para "${item.produto}":`, '35');
    if (tempoStr === null) return;
    const tempo = parseInt(tempoStr) || 35;
    setRegistrandoTunel(idx);
    try {
      const agora = agoraServidor();
      const previsto = new Date(agora.getTime() + tempo * 60000);
      const registro = {
        produto: item.produto,
        horaEntrada: agora.toTimeString().slice(0, 5),
        horaFimPrevista: previsto.toTimeString().slice(0, 5),
        horaFimReal: null,
        tempo,
        lote: '',
        timestamp: agora.toISOString(),
      };
      await setDoc(doc(db, 'producaoDiaria', dataAlvo), { tunelRegistros: arrayUnion(registro) }, { merge: true });
    } catch (e) { alert('Erro ao registrar entrada no túnel: ' + e.message); }
    finally { setRegistrandoTunel(null); }
  }

  // Término no túnel — botão aparece quando a receita é concluída (última +1)
  async function registrarTerminoTunel(item, idx) {
    const posicao = tunelRegistrosDia.findIndex(r => r.produto === item.produto);
    if (posicao === -1 || tunelRegistrosDia[posicao].horaFimReal) return;
    setRegistrandoTunel(idx);
    try {
      const novaLista = [...tunelRegistrosDia];
      novaLista[posicao] = { ...novaLista[posicao], horaFimReal: agoraServidor().toTimeString().slice(0, 5) };
      await updateDoc(doc(db, 'producaoDiaria', dataAlvo), { tunelRegistros: novaLista });
    } catch (e) { alert('Erro ao registrar término no túnel: ' + e.message); }
    finally { setRegistrandoTunel(null); }
  }

  function finalizarAntecipado(index) {
    const item = itens[index];
    if (item.feitos >= item.metaLotes || item.finalizadoAntecipadamente) return;
    setModalFinalizar({ item, idx: index });
  }

  async function confirmarFinalizacaoAntecipada(motivo) {
    const { idx, item } = modalFinalizar;
    const faltam = item.metaLotes - item.feitos;
    setSalvandoFinalizar(true);
    try {
      const nova = [...itens];
      nova[idx] = {
        ...nova[idx],
        finalizadoAntecipadamente: true,
        deficit: faltam,
        motivoFinalizacaoAntecipada: motivo,
        finalizadoAntecipadamenteEm: agoraServidor().toISOString(),
        finalizadoAntecipadamentePor: nomeOperador || 'Não identificado',
      };
      setItens(nova);
      await updateDoc(doc(db, 'producaoDiaria', dataAlvo), { itens: nova });
      setModalFinalizar(null);
    } catch (e) {
      alert('Erro ao finalizar: ' + e.message);
    } finally {
      setSalvandoFinalizar(false);
    }
  }

  // ── Paradas de linha ────────────────────────────────────────────
  const paradaAberta = paradas.find(p => !p.fim);

  async function iniciarParada(codigoObj, textoOutros) {
    setSalvandoParada(true);
    try {
      const registro = {
        codigo: codigoObj.codigo,
        label: codigoObj.codigo === CODIGO_OUTROS ? textoOutros : codigoObj.label,
        inicio: agoraServidor().toISOString(),
        fim: null,
        duracaoMin: null,
        registradoPor: nomeOperador || 'Não identificado',
      };
      await setDoc(doc(db, 'producaoDiaria', dataAlvo), { paradas: arrayUnion(registro) }, { merge: true });
      setModalParada(false);
    } catch (e) {
      alert('Erro ao registrar parada: ' + e.message);
    } finally {
      setSalvandoParada(false);
    }
  }

  async function encerrarParada() {
    const idx = paradas.findIndex(p => !p.fim);
    if (idx === -1) return;
    try {
      const inicio = new Date(paradas[idx].inicio);
      const fim = agoraServidor();
      const nova = [...paradas];
      nova[idx] = { ...nova[idx], fim: fim.toISOString(), duracaoMin: Math.round((fim - inicio) / 60000) };
      await updateDoc(doc(db, 'producaoDiaria', dataAlvo), { paradas: nova });
    } catch (e) {
      alert('Erro ao encerrar parada: ' + e.message);
    }
  }

  const ativos = [], concluidos = [];
  itens.forEach((item, idx) => { if (item.feitos >= item.metaLotes || item.finalizadoAntecipadamente) concluidos.push({ item, idx }); else ativos.push({ item, idx }); });

  function renderCard({ item, idx }) {
    const concluido = item.feitos >= item.metaLotes || item.finalizadoAntecipadamente;
    const pct = item.metaLotes > 0 ? Math.min(100, Math.round(item.feitos / item.metaLotes * 100)) : 0;
    const processando = processandoMP === idx;
    const diag = diagPorItem[item.produto];
    const farinhas = diag?.farinhas || [];
    const semRastreio = diag && !diag.receita;
    const tunelReg = tunelRegistrosDia.find(r => r.produto === item.produto);
    const registrandoEsteTunel = registrandoTunel === idx;

    return (
      <div className={'card' + (concluido ? ' concluido' : '')} key={idx}>
        <div className="card-top">
          <div className="nome">{item.produto}</div>
          {concluido && (
            <span className="selo-ok" style={item.finalizadoAntecipadamente ? { background: '#fef3c7', color: '#92400e' } : undefined}>
              {item.finalizadoAntecipadamente ? 'Finalizado (abaixo da meta)' : 'Concluído'}
            </span>
          )}
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
          <button className="btn-mais" disabled={concluido || processando || !!paradaAberta} onClick={() => bater(idx)}>
            {processando ? <i className="ph ph-circle-notch" style={{ animation: 'spin 0.6s linear infinite' }}></i> : '+1'}
          </button>
        </div>
        {!concluido && paradaAberta && (
          <div style={{ marginTop: 6, fontSize: '0.7rem', color: '#dc2626', fontWeight: 700 }}>
            ⏸ Linha parada — retome a produção para continuar.
          </div>
        )}

        {!concluido && item.feitos > 0 && (
          <button
            onClick={() => finalizarAntecipado(idx)}
            style={{ marginTop: 8, width: '100%', background: 'none', border: '1px dashed var(--border-forte)', borderRadius: 8, padding: '6px 10px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--marrom-claro)', cursor: 'pointer' }}
          >
            <i className="ph ph-flag-checkered" style={{ marginRight: 4 }}></i>Finalizar antes da meta
          </button>
        )}

        {/* ── Túnel Helicoidal: entrada aparece na 1ª batida, término na conclusão ── */}
        {item.feitos > 0 && !tunelReg && (
          <button
            onClick={() => registrarEntradaTunel(item, idx)}
            disabled={registrandoEsteTunel}
            style={{ marginTop: 8, width: '100%', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 8, padding: '8px 10px', fontSize: '0.75rem', fontWeight: 700, color: '#1e40af', cursor: registrandoEsteTunel ? 'wait' : 'pointer' }}
          >
            <i className="ph ph-thermometer-cold" style={{ marginRight: 6 }}></i>
            {registrandoEsteTunel ? 'Registrando...' : 'Registrar entrada no túnel'}
          </button>
        )}

        {tunelReg && !tunelReg.horaFimReal && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 8, padding: '8px 10px' }}>
            <span style={{ fontSize: '0.72rem', color: '#1e40af', fontWeight: 700 }}>
              🧊 Entrou {tunelReg.horaEntrada} · previsão {tunelReg.horaFimPrevista}
            </span>
            {concluido && (
              <button
                onClick={() => registrarTerminoTunel(item, idx)}
                disabled={registrandoEsteTunel}
                style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: '0.72rem', fontWeight: 700, cursor: registrandoEsteTunel ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
              >
                {registrandoEsteTunel ? 'Registrando...' : 'Registrar término'}
              </button>
            )}
          </div>
        )}

        {tunelReg?.horaFimReal && (
          <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#1e40af', background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 8, padding: '8px 10px', fontWeight: 700 }}>
            🧊 Túnel: {tunelReg.horaEntrada} → {tunelReg.horaFimReal}
          </div>
        )}

        {item.finalizadoAntecipadamente && (
          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', fontSize: '0.72rem', color: '#92400e', lineHeight: 1.4 }}>
            <strong>⚠️ Finalizado antes da meta — faltaram {item.deficit} receita{item.deficit === 1 ? '' : 's'}.</strong>
            <div style={{ marginTop: 2 }}>Motivo: {item.motivoFinalizacaoAntecipada}</div>
            <div style={{ fontSize: '0.65rem', marginTop: 2, opacity: 0.85 }}>
              {item.finalizadoAntecipadamentePor} às {item.finalizadoAntecipadamenteEm ? new Date(item.finalizadoAntecipadamenteEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
            </div>
          </div>
        )}

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
        <div className="card" style={{ borderLeftColor: paradaAberta ? '#dc2626' : '#16a34a', marginBottom: 14 }}>
          {paradaAberta ? (
            <>
              <div style={{ fontWeight: 900, color: '#dc2626', fontSize: '1rem' }}>🔴 Linha parada — [{paradaAberta.codigo}] {paradaAberta.label}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--marrom-claro)', marginTop: 4 }}>
                Desde {new Date(paradaAberta.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · registrado por {paradaAberta.registradoPor}
              </div>
              <button className="btn btn-block" style={{ marginTop: 12, background: '#16a34a', color: 'white', borderColor: '#16a34a' }} onClick={encerrarParada}>
                ✓ Retomar produção
              </button>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 900, color: '#16a34a', fontSize: '1rem' }}>🟢 Linha em produção</div>
              <button className="btn btn-outline btn-block" style={{ marginTop: 10 }} onClick={() => setModalParada(true)}>
                ⏸ Registrar parada
              </button>
            </>
          )}
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

      {modalParada && (
        <ModalIniciarParada
          aoConfirmar={iniciarParada}
          aoFechar={() => setModalParada(false)}
          salvando={salvandoParada}
        />
      )}

      {modalFinalizar && (
        <ModalMotivoFinalizacao
          item={modalFinalizar.item}
          aoConfirmar={confirmarFinalizacaoAntecipada}
          aoFechar={() => setModalFinalizar(null)}
          salvando={salvandoFinalizar}
        />
      )}
    </div>
  );
}
