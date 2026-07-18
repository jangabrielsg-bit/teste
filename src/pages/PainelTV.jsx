import { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot, getDoc, collection } from 'firebase/firestore';
import { db, dbEstoqueOS } from '../services/firebase';
import { hojeISO, amanhaISO, formatarDataBR, formatarHoraData } from '../services/utils';
import { useMPOcultos } from '../services/hooks';
import { agoraServidor } from '../services/relogioServidor';

// ── Hook: Estoque MP — polling a cada 30min (era 5min) ────────────
function useEstoqueMP(ativo) {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;

    async function buscar() {
      try {
        const cDoc = await getDoc(doc(dbEstoqueOS, 'global_settings', 'company_db'));
        if (!cDoc.exists() || !cDoc.data().masterUid) return;
        const mUid = cDoc.data().masterUid;

        // Lê inventory e batches em paralelo (2 getDocs em vez de onSnapshot)
        const [invSnap, batSnap] = await Promise.all([
          import('firebase/firestore').then(({ getDocs, collection }) =>
            getDocs(collection(dbEstoqueOS, 'users', mUid, 'inventory'))),
          import('firebase/firestore').then(({ getDocs, collection }) =>
            getDocs(collection(dbEstoqueOS, 'users', mUid, 'batches'))),
        ]);

        const saldos = {};
        batSnap.forEach(b => {
          const d = b.data();
          const pid = d.productId || d.item_id;
          if (pid) saldos[pid] = (saldos[pid] || 0) + (parseFloat(d.quantity) || 0);
        });

        const lista = [];
        invSnap.forEach(d => {
          const inv = d.data();
          lista.push({
            id: d.id,
            nome: inv.name || d.id,
            unidade: inv.unit || 'kg',
            saldo: saldos[d.id] || 0,
            minimo: inv.minimumQuantity || inv.minimumStock || inv.min_quantity || 0,
          });
        });

        lista.sort((a, b) => {
          const ca = a.minimo > 0 && a.saldo <= a.minimo ? 0 : 1;
          const cb = b.minimo > 0 && b.saldo <= b.minimo ? 0 : 1;
          if (ca !== cb) return ca - cb;
          return a.nome.localeCompare(b.nome, 'pt-BR');
        });

        if (vivo) { setItens(lista); setCarregando(false); }
      } catch (e) {
        console.error('MP para PainelTV:', e);
        if (vivo) setCarregando(false);
      }
    }

    buscar();
    // ✅ Polling a cada 30min (era 5min = 6× menos leituras)
    const t = setInterval(buscar, 30 * 60 * 1000);
    return () => { vivo = false; clearInterval(t); };
  }, [ativo]);

  return { itens, carregando };
}

const ABAS = ['fluxo', 'producao', 'masseira', 'patinhas', 'estoque_pa', 'estoque_mp'];
const NOMES_ABAS = { fluxo: 'Fluxo da Linha', producao: 'Visão Geral', masseira: 'Masseira', patinhas: 'Patinhas', estoque_pa: 'Est. PA', estoque_mp: 'Est. MP' };

export default function PainelTV({ sair }) {
  const dataHoje = hojeISO();
  const [aba, setAba]               = useState('producao');
  const [autoRodizio, setAutoRodizio] = useState(false);
  const [agora, setAgora]           = useState(agoraServidor());
  const [itens, setItens]           = useState([]);
  const [existe, setExiste]         = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [estoquePA, setEstoquePA]   = useState([]);
  const [patinhas, setPatinhas]     = useState([]);
  const [paradas, setParadas]       = useState([]);
  const [programaAmanha, setProgramaAmanha] = useState(null); // itens confirmados p/ amanhã (kits em preparo hoje)

  // Relógio — sincronizado com o servidor (não com o hardware da TV/tablet)
  useEffect(() => {
    const t = setInterval(() => setAgora(agoraServidor()), 1000);
    return () => clearInterval(t);
  }, []);

  // ✅ Produção do dia — onSnapshot num único doc (necessário: tempo real)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'producaoDiaria', dataHoje), snap => {
      setCarregando(false);
      if (snap.exists()) {
        setExiste(true);
        setItens(snap.data().itens || []);
        setParadas(snap.data().paradas || []);
      } else {
        setExiste(false); setItens([]); setParadas([]);
      }
    });
    return unsub;
  }, [dataHoje]);

  // ✅ Programação de amanhã — reflete a janela de 24h dos kits:
  // o que está confirmado para amanhã é o que o preparo fraciona hoje.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'producaoDiaria', amanhaISO()), snap => {
      setProgramaAmanha(snap.exists() ? (snap.data().itens || []) : null);
    });
    return unsub;
  }, [dataHoje]);

  // ✅ Patinhas pesadas hoje — confirmadas (expedicaoDiaria) + em andamento
  // (pesagensEmAndamento, uma sub-sessão por dispositivo pesando agora).
  // Assim a patinha some no painel no momento da pesagem, não só depois
  // de o operador clicar em "Confirmar Entrada".
  const [patinhasConfirmadas, setPatinhasConfirmadas] = useState([]);
  const [patinhasPendentes, setPatinhasPendentes]     = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'expedicaoDiaria', dataHoje), snap => {
      setPatinhasConfirmadas(snap.exists() ? (snap.data().registros || []) : []);
    });
    return unsub;
  }, [dataHoje]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pesagensEmAndamento', dataHoje, 'sessoes'), snap => {
      const lista = [];
      snap.forEach(d => (d.data().itens || []).forEach(it => lista.push(it)));
      setPatinhasPendentes(lista);
    });
    return unsub;
  }, [dataHoje]);

  useEffect(() => {
    const pendentesFmt = patinhasPendentes.map(it => ({
      id: it.id,
      produto: it.nome,
      codigoProduto: it.codigo,
      lote: it.lote,
      pesoTotal: it.qtd,
      timestamp: it.timestamp,
      pendente: true,
    }));
    const lista = [...patinhasConfirmadas, ...pendentesFmt]
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    setPatinhas(lista);
  }, [patinhasConfirmadas, patinhasPendentes]);

  // ✅ Estoque PA — escuta doc RESUMO único em vez da coleção inteira
  // A bridge grava estoquePA_resumo/atual com a lista completa
  // → 1 leitura por sync em vez de N leituras (uma por produto)
  useEffect(() => {
    if (aba !== 'estoque_pa') return;
    const unsub = onSnapshot(doc(db, 'estoquePA_resumo', 'atual'), snap => {
      if (snap.exists()) {
        const lista = snap.data().itens || [];
        lista.sort((a, b) => {
          const ca = a.estoqueMinimo > 0 && a.estoqueAtual <= a.estoqueMinimo ? 0 : 1;
          const cb = b.estoqueMinimo > 0 && b.estoqueAtual <= b.estoqueMinimo ? 0 : 1;
          if (ca !== cb) return ca - cb;
          return (a.produto || '').localeCompare(b.produto || '', 'pt-BR');
        });
        setEstoquePA(lista);
      }
    });
    return unsub;
  }, [aba]);

  // ✅ Reload automático via Firestore — escuta bridge/versao
  // Quando a bridge grava uma versão nova (após deploy ou sync),
  // o painel recarrega sozinho sem precisar ir até a TV.
  useEffect(() => {
    let versaoAtual = null;
    const unsub = onSnapshot(doc(db, 'bridge', 'versao'), snap => {
      if (!snap.exists()) return;
      const v = snap.data().valor;
      if (versaoAtual === null) { versaoAtual = v; return; } // ignora na primeira leitura
      if (v !== versaoAtual) {
        console.log(`🔄 Nova versão detectada (${versaoAtual} → ${v}). Recarregando...`);
        setTimeout(() => window.location.reload(), 2000); // aguarda 2s para não recarregar no meio de uma animação
      }
    });
    return unsub;
  }, []);

  // Estoque MP
  const mpOcultos = useMPOcultos();
  const { itens: estoqueMPBruto, carregando: carregandoMP } = useEstoqueMP(aba === 'estoque_mp');
  const estoqueMP = estoqueMPBruto.filter(item => !mpOcultos[item.id]);

  // ── Declutter: por padrão, PA e MP mostram só o que é relevante à
  // produção programada hoje (linha piloto) — não o catálogo inteiro.
  const [mostrarTodosPA, setMostrarTodosPA] = useState(false);
  const [mostrarTodosMP, setMostrarTodosMP] = useState(false);

  const codigosHoje = new Set(itens.map(it => it.codigo).filter(Boolean));
  const nomesHoje = new Set(itens.map(it => it.produto).filter(Boolean));
  const estoquePAFiltrado = mostrarTodosPA
    ? estoquePA
    : estoquePA.filter(item => codigosHoje.has(item.codigo) || nomesHoje.has(item.produto));
  const estoquePAExibida = estoquePAFiltrado.length > 0 || mostrarTodosPA ? estoquePAFiltrado : estoquePA;

  const nomesInsumosHoje = new Set(
    itens.flatMap(it => (it.consumoMP || []).flatMap(c => (c.consumos || []).map(x => x.nomeMP))).filter(Boolean)
  );
  const estoqueMPFiltrado = mostrarTodosMP
    ? estoqueMP
    : nomesInsumosHoje.size > 0
      ? estoqueMP.filter(item => nomesInsumosHoje.has(item.nome))
      : estoqueMP.filter(item => item.minimo > 0);
  const estoqueMPExibida = estoqueMPFiltrado.length > 0 || mostrarTodosMP ? estoqueMPFiltrado : estoqueMP;

  // Rodízio automático
  useEffect(() => {
    if (!autoRodizio) return;
    const t = setInterval(() => {
      setAba(prev => ABAS[(ABAS.indexOf(prev) + 1) % ABAS.length]);
    }, 30000);
    return () => clearInterval(t);
  }, [autoRodizio]);

  function alternarTelaCheia() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  function tempoDecorrido(iso) {
    if (!iso) return '—:—';
    const seg = Math.max(0, Math.floor((agora.getTime() - new Date(iso).getTime()) / 1000));
    return `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`;
  }

  function velItem(item) {
    const b = item.batidas || [];
    if (b.length < 2) return null;
    return (new Date(b.at(-1)).getTime() - new Date(b[0]).getTime()) / 60000 / (b.length - 1);
  }

  const totalProgramado = itens.reduce((s, it) => s + (it.metaLotes || 0), 0);
  const totalFeito      = itens.reduce((s, it) => s + (it.feitos || 0), 0);
  const pctGeral        = totalProgramado > 0 ? Math.round(totalFeito / totalProgramado * 100) : 0;
  const ordenados       = [...itens].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  const itemAtivo       = ordenados.find(it => it.feitos < it.metaLotes) || null;

  const todasBatidas      = itens.flatMap(it => it.batidas || []).sort();
  const ultimaBatidaGeral = todasBatidas.at(-1) || null;
  const velocidadeGeral   = (() => {
    if (todasBatidas.length < 2) return null;
    const min = (new Date(todasBatidas.at(-1)).getTime() - new Date(todasBatidas[0]).getTime()) / 60000;
    return min > 0 ? (todasBatidas.length - 1) / min : null;
  })();

  // ── Velocidade em janela móvel de 1h: conta quantas receitas saíram
  // nos últimos 60 minutos (pelo relógio do servidor, não do aparelho) e
  // divide pelo tempo decorrido nessa janela. Diferente da "velocidade
  // geral" (média do dia inteiro), esta reage rápido a uma parada ou
  // uma arrancada recente — é o "ritmo agora" da linha.
  const JANELA_VELOCIDADE_MIN = 60;
  const receitasUltimaHora = todasBatidas.filter(b => (agora.getTime() - new Date(b).getTime()) / 60000 <= JANELA_VELOCIDADE_MIN).length;
  const velocidadeUltimaHora = (() => {
    if (receitasUltimaHora === 0 || !ultimaBatidaGeral) return null;
    const primeiraNaJanela = todasBatidas.find(b => (agora.getTime() - new Date(b).getTime()) / 60000 <= JANELA_VELOCIDADE_MIN);
    const minutosNaJanela = Math.min(JANELA_VELOCIDADE_MIN, (agora.getTime() - new Date(primeiraNaJanela).getTime()) / 60000);
    return minutosNaJanela > 0 ? receitasUltimaHora / minutosNaJanela : null;
  })();

  const porCategoria = {};
  ordenados.forEach(it => {
    const cat = it.categoria || 'Sem setor';
    if (!porCategoria[cat]) porCategoria[cat] = [];
    porCategoria[cat].push(it);
  });

  // ── OEE provisório: Performance baseada no programado (metaLotes),
  // já que ainda não há tempo de ciclo por máquina. Disponibilidade vem
  // das paradas registradas pelo operador; Qualidade, da massa perdida
  // apontada no Fechamento. Troca-se a Performance por dado de máquina
  // quando isso existir, sem mudar o resto da conta.
  const oee = (() => {
    if (totalProgramado === 0) return null; // sem programação hoje, não há o que medir

    const primeiraBatida = todasBatidas[0] || null;
    if (!primeiraBatida) {
      // Programado, mas ainda sem nenhuma batida — mostra o card zerado
      // em vez de escondê-lo, pra ficar claro que está "aguardando início".
      return { disponibilidade: 0, performance: 0, qualidade: 1, valor: 0, tempoParadoMin: 0, aindaNaoComecou: true };
    }

    const tempoTotalMin = Math.max(1, (agora.getTime() - new Date(primeiraBatida).getTime()) / 60000);
    const tempoParadoMin = paradas.reduce((acc, p) => {
      const fim = p.fim ? new Date(p.fim) : agora;
      return acc + Math.max(0, (fim.getTime() - new Date(p.inicio).getTime()) / 60000);
    }, 0);
    const disponibilidade = Math.max(0, Math.min(1, (tempoTotalMin - tempoParadoMin) / tempoTotalMin));

    const performance = Math.max(0, Math.min(1, totalFeito / totalProgramado));

    const brutoTotal  = itens.reduce((s, it) => s + (it.rendimentoTeorico || 0) * (it.feitos || 0), 0);
    const perdasTotal = itens.reduce((s, it) => s + (it.massaPerdidaProd || 0) + (it.massaPerdidaEmb || 0), 0);
    const qualidade = brutoTotal > 0 ? Math.max(0, Math.min(1, (brutoTotal - perdasTotal) / brutoTotal)) : 1;

    return { disponibilidade, performance, qualidade, valor: disponibilidade * performance * qualidade, tempoParadoMin };
  })();

  const S = {
    shell:   { display: 'flex', flexDirection: 'column', height: '100vh', background: '#3D2515', color: '#D0B29E', fontFamily: "'Inter', sans-serif", overflow: 'hidden' },
    header:  { height: 64, background: '#2A170A', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: '1px solid #5C3A21', flexShrink: 0, gap: 12 },
    main:    { flex: 1, padding: '20px 24px', overflowY: 'auto' },
    card:    { background: '#4A2E1A', borderRadius: 16, padding: 20, border: '1px solid #734A2A' },
    cardDark:{ background: '#2A170A', borderRadius: 14, padding: '14px 18px', border: '1px solid #5C3A21' },
    label:   { fontSize: '0.68rem', fontWeight: 800, color: '#D0B29E', textTransform: 'uppercase', letterSpacing: '0.07em' },
    h3:      { fontSize: '1.3rem', fontWeight: 700, textAlign: 'center', color: 'white', marginBottom: 20 },
  };

  return (
    <div style={S.shell}>

      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <img src={import.meta.env.BASE_URL + 'logo.png'} alt="IMAC" style={{ height: 36 }} />
          <span style={{ fontSize: '1.1rem', fontWeight: 900, color: '#F6BE00', letterSpacing: 2, textTransform: 'uppercase' }}>Painel Industrial</span>
        </div>

        <div style={{ display: 'flex', background: '#3D2515', padding: 3, borderRadius: 8, border: '1px solid #734A2A', gap: 3 }}>
          {ABAS.map(a => (
            <button key={a} onClick={() => { setAba(a); setAutoRodizio(false); }} style={{
              padding: '7px 14px', borderRadius: 5, fontWeight: 700, fontSize: '0.82rem',
              border: 'none', cursor: 'pointer',
              background: aba === a ? '#F6BE00' : 'transparent',
              color: aba === a ? '#2A170A' : '#D0B29E',
              transition: 'all 0.15s',
            }}>{NOMES_ABAS[a]}</button>
          ))}
          <button onClick={() => setAutoRodizio(v => !v)} style={{
            padding: '7px 14px', borderRadius: 5, fontWeight: 700, fontSize: '0.82rem',
            border: 'none', cursor: 'pointer',
            background: autoRodizio ? '#10b981' : 'transparent',
            color: autoRodizio ? '#fff' : '#D0B29E',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <i className={`ph ${autoRodizio ? 'ph-arrows-clockwise' : 'ph-play'}`}></i> Auto 30s
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 700, color: '#F6BE00' }}>
            {agora.toLocaleTimeString('pt-BR')}
          </span>
          <span style={{ fontSize: '0.8rem', color: '#D0B29E' }}>{formatarDataBR(dataHoje)}</span>
          <button onClick={alternarTelaCheia} style={{ background: '#F6BE00', color: '#2A170A', padding: '6px 12px', borderRadius: 6, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
            <i className="ph ph-corners-out"></i>
          </button>
          {sair && <button onClick={sair} style={{ background: '#4A2E1A', color: 'white', padding: '6px 12px', borderRadius: 6, fontWeight: 700, border: '1px solid #734A2A', cursor: 'pointer' }}>Voltar</button>}
        </div>
      </header>

      <style>{`@keyframes sinoPulseTv { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>

      {/* ── Sinalização: linha parada agora, ou item finalizado abaixo da meta ── */}
      {(() => {
        const paradaAberta = paradas.find(p => !p.fim);
        const finalizadosAbaixo = itens.filter(it => it.finalizadoAntecipadamente);
        if (!paradaAberta && finalizadosAbaixo.length === 0) return null;
        return (
          <div style={{ background: '#5c1a1a', borderBottom: '2px solid #dc2626', padding: '10px 24px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            {paradaAberta && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#fecaca', animation: 'sinoPulseTv 1.4s ease-in-out infinite' }}>
                <i className="ph ph-pause-circle" style={{ fontSize: '1.2rem' }}></i>
                LINHA PARADA — {paradaAberta.label} (há {tempoDecorrido(paradaAberta.inicio)})
              </div>
            )}
            {finalizadosAbaixo.map((it, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#fecaca', fontSize: '0.85rem' }}>
                <i className="ph ph-flag-checkered"></i>
                {it.produto} finalizado com {it.feitos}/{it.metaLotes} (faltaram {it.deficit})
              </div>
            ))}
          </div>
        );
      })()}

      <main style={S.main}>

        {/* ABA 0 — FLUXO DA LINHA (mapa didático: estoque → ... → expedição) */}
        {aba === 'fluxo' && (() => {
          // Cada etapa espelha um setor físico do layout da fábrica.
          // Regra didática de cor: verde = fluindo, amarelo = atenção,
          // vermelho = travado, cinza = sem dado / etapa manual.
          const paradaAberta = paradas.find(p => !p.fim);
          const pesandoAgora = patinhasPendentes;
          const kgPesando = pesandoAgora.reduce((s, p) => s + (parseFloat(p.qtd) || 0), 0);
          const kgCamara = patinhasConfirmadas.reduce((s, p) => s + (parseFloat(p.pesoTotal) || 0), 0);
          const finalizadosAbaixo = itens.filter(it => it.finalizadoAntecipadamente).length;

          const etapas = [
            {
              icone: 'ph-calendar-check',
              titulo: '1. PCP / Kits',
              subtitulo: 'Programação de amanhã (kits fracionados hoje, 24h antes)',
              valor: programaAmanha ? `${programaAmanha.length}` : '—',
              unidade: programaAmanha ? 'receitas programadas' : 'sem programação ainda',
              cor: programaAmanha ? '#4ade80' : '#6b7280',
              detalhe: programaAmanha
                ? `${programaAmanha.reduce((s, it) => s + (it.metaLotes || 0), 0)} lotes no total para ${formatarDataBR(amanhaISO())}`
                : 'O líder ainda não confirmou a programação de amanhã.',
            },
            {
              icone: 'ph-cooking-pot',
              titulo: '2. Produção',
              subtitulo: 'Setor de produção — linha piloto de pães',
              valor: `${totalFeito} / ${totalProgramado}`,
              unidade: 'receitas hoje',
              cor: paradaAberta ? '#f87171' : totalProgramado > 0 && totalFeito >= totalProgramado ? '#4ade80' : '#F6BE00',
              detalhe: paradaAberta
                ? `🔴 LINHA PARADA — ${paradaAberta.label} (há ${tempoDecorrido(paradaAberta.inicio)})`
                : finalizadosAbaixo > 0
                  ? `⚠ ${finalizadosAbaixo} receita(s) finalizada(s) abaixo da meta`
                  : totalProgramado > 0 ? `${pctGeral}% da meta do dia` : 'Nada programado para hoje.',
              alerta: !!paradaAberta,
            },
            {
              icone: 'ph-scales',
              titulo: '3. Pesagem / Embalagem',
              subtitulo: 'Embaladora → balança da expedição',
              valor: `${pesandoAgora.length}`,
              unidade: pesandoAgora.length === 1 ? 'patinha sendo pesada' : 'patinhas sendo pesadas',
              cor: pesandoAgora.length > 0 ? '#F6BE00' : '#6b7280',
              detalhe: pesandoAgora.length > 0 ? `${kgPesando.toFixed(2)} kg aguardando confirmação` : 'Nenhuma pesagem em andamento.',
            },
            {
              icone: 'ph-snowflake',
              titulo: '4. Câmara de Produto Acabado',
              subtitulo: 'Entradas confirmadas hoje',
              valor: kgCamara.toFixed(0),
              unidade: 'kg na câmara hoje',
              cor: kgCamara > 0 ? '#4ade80' : '#6b7280',
              detalhe: `${patinhasConfirmadas.length} patinha(s) confirmada(s) no dia.`,
            },
          ];

          return (
            <>
              <h3 style={S.h3}><i className="ph ph-flow-arrow" style={{ color: '#F6BE00', marginRight: 8 }}></i>Fluxo da Linha — do PCP à Câmara</h3>
              <div style={{ textAlign: 'center', fontSize: '0.72rem', color: '#D0B29E', marginTop: -12, marginBottom: 18 }}>
                Leia da esquerda para a direita: é o mesmo caminho físico da fábrica. Verde = fluindo · Amarelo = em atividade · Vermelho = travado · Cinza = sem movimento.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
                {etapas.map((et, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <div style={{
                      ...S.card,
                      borderLeft: `5px solid ${et.cor}`,
                      height: '100%',
                      boxShadow: et.alerta ? '0 0 18px rgba(248,113,113,0.45)' : 'none',
                      animation: et.alerta ? 'sinoPulseTv 1.4s ease-in-out infinite' : 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <i className={`ph ${et.icone}`} style={{ color: et.cor, fontSize: '1.3rem' }}></i>
                        <span style={{ fontWeight: 800, color: 'white', fontSize: '0.95rem' }}>{et.titulo}</span>
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#D0B29E', marginBottom: 10 }}>{et.subtitulo}</div>
                      <div style={{ fontSize: '2rem', fontWeight: 900, color: et.cor, lineHeight: 1 }}>
                        {et.valor} <span style={{ fontSize: '0.75rem', color: '#D0B29E', fontWeight: 700 }}>{et.unidade}</span>
                      </div>
                      <div style={{ marginTop: 10, fontSize: '0.75rem', color: et.alerta ? '#fecaca' : '#D0B29E', fontWeight: et.alerta ? 800 : 400 }}>
                        {et.detalhe}
                      </div>
                    </div>
                    {i < etapas.length - 1 && (
                      <div style={{ position: 'absolute', right: -14, top: '50%', transform: 'translateY(-50%)', color: '#734A2A', fontSize: '1.2rem', zIndex: 1 }}>
                        <i className="ph ph-caret-right"></i>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          );
        })()}

        {/* ABA 1 — VISÃO GERAL */}
        {aba === 'producao' && (
          <>
            {carregando && <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>Carregando...</div>}
            {!carregando && !existe && <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>Nenhuma produção programada para hoje.</div>}
            {!carregando && existe && (
              <>
                {oee && (
                  <div style={{ ...S.card, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#F6BE00', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        <i className="ph ph-gauge" style={{ marginRight: 6 }}></i>OEE do dia
                      </div>
                      <div style={{ fontSize: '2rem', fontWeight: 900, color: oee.aindaNaoComecou ? '#6b7280' : oee.valor >= 0.85 ? '#4ade80' : oee.valor >= 0.6 ? '#F6BE00' : '#f87171' }}>
                        {oee.aindaNaoComecou ? '—' : `${Math.round(oee.valor * 100)}%`}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={S.label}>Disponibilidade</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 900, color: 'white', marginTop: 2 }}>{oee.aindaNaoComecou ? '—' : `${Math.round(oee.disponibilidade * 100)}%`}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={S.label}>Performance</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 900, color: 'white', marginTop: 2 }}>{oee.aindaNaoComecou ? '—' : `${Math.round(oee.performance * 100)}%`}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={S.label}>Qualidade</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 900, color: 'white', marginTop: 2 }}>{oee.aindaNaoComecou ? '—' : `${Math.round(oee.qualidade * 100)}%`}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 10, fontSize: '0.65rem', color: '#D0B29E', textAlign: 'center' }}>
                      {oee.aindaNaoComecou
                        ? 'Aguardando a primeira batida do dia.'
                        : `Provisório: Performance baseada no programado (sem tempo de ciclo de máquina) · ${Math.round(oee.tempoParadoMin)} min parado hoje`}
                    </div>
                  </div>
                )}

                <div style={{ ...S.cardDark, marginBottom: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: '2.8rem', fontWeight: 900, color: '#F6BE00', lineHeight: 1 }}>
                    {totalFeito}<span style={{ fontSize: '1.4rem', color: '#D0B29E', fontWeight: 700 }}> / {totalProgramado}</span>
                  </div>
                  <div style={{ ...S.label, marginTop: 4 }}>receitas produzidas hoje</div>
                  <div style={{ marginTop: 10, background: '#3D2515', borderRadius: 20, height: 12, overflow: 'hidden' }}>
                    <div style={{ background: '#F6BE00', height: '100%', width: pctGeral + '%', transition: 'width 1s', borderRadius: 20 }}></div>
                  </div>
                  <div style={{ marginTop: 4, fontSize: '0.85rem', fontWeight: 700, color: '#F6BE00' }}>{pctGeral}%</div>
                </div>

                {Object.entries(porCategoria).map(([cat, catItens]) => (
                  <div key={cat} style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#F6BE00', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>{cat}</div>
                    <div style={{ display: 'grid', gap: 12 }}>
                      {catItens.map((item, idx) => {
                        const perc = item.metaLotes ? Math.min(100, Math.round((item.feitos || 0) / item.metaLotes * 100)) : 0;
                        const concluido = (item.feitos || 0) >= item.metaLotes;
                        const abaixoDaMeta = item.finalizadoAntecipadamente;
                        return (
                          <div key={idx} style={{ ...S.card, borderLeft: `4px solid ${abaixoDaMeta ? '#f59e0b' : concluido ? '#15803d' : item === itemAtivo ? '#F6BE00' : '#734A2A'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <div style={{ fontWeight: 700, color: 'white' }}>{item.produto}</div>
                              <div style={{ fontFamily: 'monospace', color: '#D0B29E' }}>
                                <span style={{ fontSize: '1.4rem', fontWeight: 900, color: abaixoDaMeta ? '#fbbf24' : concluido ? '#4ade80' : '#F6BE00' }}>{item.feitos || 0}</span>
                                {' '}/{' '}{item.metaLotes}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, background: '#2A170A', border: '1px solid #5C3A21', borderRadius: 20, height: 10, overflow: 'hidden' }}>
                                <div style={{ background: abaixoDaMeta ? '#f59e0b' : concluido ? '#15803d' : '#F6BE00', height: '100%', width: Math.max(perc, 3) + '%', transition: 'width 1s', borderRadius: 20 }}></div>
                              </div>
                              <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#D0B29E', width: 34, textAlign: 'right' }}>{perc}%</span>
                            </div>
                            {abaixoDaMeta && (
                              <div style={{ marginTop: 6, fontSize: '0.7rem', fontWeight: 700, color: '#fbbf24' }}>
                                ⚠ Finalizado abaixo da meta — faltaram {item.deficit}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ABA 2 — MASSEIRA */}
        {aba === 'masseira' && (
          <>
            <h3 style={S.h3}><i className="ph ph-bowl-food" style={{ color: '#F6BE00', marginRight: 8 }}></i>Produção Masseira</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div style={{ ...S.cardDark, textAlign: 'center' }}>
                <div style={S.label}>⚡ Ritmo (última hora)</div>
                <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#F6BE00', marginTop: 6 }}>
                  {velocidadeUltimaHora != null ? velocidadeUltimaHora.toFixed(2) : '—'}
                  <span style={{ fontSize: '0.9rem', color: '#D0B29E', marginLeft: 4 }}>rec/min</span>
                </div>
                <div style={{ fontSize: '0.68rem', color: '#D0B29E', marginTop: 4 }}>
                  {receitasUltimaHora} receita{receitasUltimaHora === 1 ? '' : 's'} nos últimos 60 min
                </div>
              </div>
              <div style={{ ...S.cardDark, textAlign: 'center' }}>
                <div style={S.label}>📊 Média do dia</div>
                <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#D0B29E', marginTop: 6 }}>
                  {velocidadeGeral != null ? velocidadeGeral.toFixed(2) : '—'}
                  <span style={{ fontSize: '0.9rem', color: '#D0B29E', marginLeft: 4 }}>rec/min</span>
                </div>
              </div>
              <div style={{ ...S.cardDark, textAlign: 'center' }}>
                <div style={S.label}>🕐 Última receita na masseira</div>
                <div style={{ fontSize: '2.2rem', fontWeight: 900, color: ultimaBatidaGeral ? '#4ade80' : '#6b7280', marginTop: 6 }}>
                  {tempoDecorrido(ultimaBatidaGeral)}
                  {ultimaBatidaGeral && <span style={{ fontSize: '0.85rem', color: '#D0B29E', marginLeft: 4 }}>atrás</span>}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              {ordenados.map((item, idx) => {
                const perc = item.metaLotes ? Math.min(100, Math.round((item.feitos || 0) / item.metaLotes * 100)) : 0;
                const concluido = (item.feitos || 0) >= item.metaLotes;
                const vel = velItem(item);
                const ub = item.batidas?.at(-1);
                const abaixoDaMeta = item.finalizadoAntecipadamente;
                return (
                  <div key={idx} style={{ ...S.card, borderLeft: `4px solid ${abaixoDaMeta ? '#f59e0b' : concluido ? '#15803d' : item === itemAtivo ? '#F6BE00' : '#734A2A'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      {/* Nome + velocidade */}
                      <div>
                        <div style={{ fontWeight: 700, color: 'white', fontSize: '1.1rem' }}>{item.produto}</div>
                        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
                          {vel != null && !concluido && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#3D2515', border: '1px solid #734A2A', borderRadius: 20, padding: '3px 10px', fontSize: '0.78rem', fontWeight: 700, color: '#F6BE00' }}>
                              ⚡ {vel.toFixed(1)} <span style={{ color: '#D0B29E', fontWeight: 400 }}>rec/min</span>
                            </span>
                          )}
                          {ub && !concluido && (
                            <span style={{ fontSize: '0.72rem', color: '#D0B29E' }}>
                              🕐 há {tempoDecorrido(ub)}
                            </span>
                          )}
                          {abaixoDaMeta && (
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fbbf24' }}>⚠ Finalizado abaixo da meta (faltaram {item.deficit})</span>
                          )}
                          {concluido && !abaixoDaMeta && (
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4ade80' }}>✔ Concluído</span>
                          )}
                        </div>
                      </div>
                      {/* Contador */}
                      <div style={{ textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>
                        <span style={{ fontSize: '1.8rem', fontWeight: 900, color: abaixoDaMeta ? '#fbbf24' : concluido ? '#4ade80' : '#F6BE00' }}>{item.feitos || 0}</span>
                        <span style={{ color: '#D0B29E', fontSize: '1rem' }}> / {item.metaLotes}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, background: '#2A170A', border: '1px solid #5C3A21', borderRadius: 20, height: 12, overflow: 'hidden' }}>
                        <div style={{ background: abaixoDaMeta ? '#f59e0b' : concluido ? '#15803d' : '#F6BE00', height: '100%', width: Math.max(perc, 3) + '%', transition: 'width 1s', borderRadius: 20 }}></div>
                      </div>
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#D0B29E', width: 38, textAlign: 'right' }}>{perc}%</span>
                    </div>
                  </div>
                );
              })}
              {ordenados.length === 0 && <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>Nenhuma produção programada para hoje.</div>}
            </div>
          </>
        )}

        {/* ABA 3 — PATINHAS PESADAS */}
        {aba === 'patinhas' && (
          <>
            <h3 style={S.h3}><i className="ph ph-scales" style={{ color: '#F6BE00', marginRight: 8 }}></i>Patinhas Pesadas Hoje</h3>
            {patinhas.length === 0 && <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>Nenhuma patinha pesada ainda hoje.</div>}
            <div style={{ display: 'grid', gap: 10 }}>
              {patinhas.map((r, i) => (
                <div key={r.id || i} style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, border: r.pendente ? '1px solid #F6BE00' : undefined }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {r.produto}
                      {r.pendente && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#2A170A', background: '#F6BE00', padding: '2px 8px', borderRadius: 20, animation: 'sinoPulseTv 1.4s ease-in-out infinite' }}>
                          PESANDO...
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#D0B29E', marginTop: 2 }}>
                      {r.lote && <>Lote: {r.lote} · </>}{r.codigoProduto && <>COD {r.codigoProduto}</>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 900, color: '#F6BE00', fontSize: '1.1rem' }}>{(r.pesoTotal || 0).toFixed(2)} kg</div>
                    <div style={{ fontSize: '0.75rem', color: '#D0B29E', fontFamily: 'monospace' }}>
                      {r.horario || formatarHoraData(r.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ABA 3 — ESTOQUE PA */}
        {aba === 'estoque_pa' && (
          <>
            <h3 style={S.h3}><i className="ph ph-snowflake" style={{ color: '#F6BE00', marginRight: 8 }}></i>Estoque Produto Acabado</h3>
            {estoquePA.length > estoquePAExibida.length && (
              <div style={{ textAlign: 'center', marginBottom: 14 }}>
                <button onClick={() => setMostrarTodosPA(v => !v)} style={{ background: 'transparent', border: '1px solid #734A2A', color: '#D0B29E', borderRadius: 20, padding: '6px 16px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>
                  {mostrarTodosPA ? `Mostrar só os da produção de hoje (${estoquePAFiltrado.length})` : `Mostrando itens da produção de hoje · ver todos (${estoquePA.length})`}
                </button>
              </div>
            )}
            {estoquePA.length === 0 && <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>Aguardando dados...</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
              {estoquePAExibida.map((item, i) => {
                const abaixoMin = item.estoqueMinimo > 0 && item.estoqueAtual <= item.estoqueMinimo;
                const cobDias   = item.coberturaDias ?? (item.mediaSaidaDiaria > 0 ? item.estoqueAtual / item.mediaSaidaDiaria : null);
                const emAviso   = !abaixoMin && cobDias != null && cobDias < 2;
                const corBorda  = abaixoMin ? '#dc2626' : emAviso ? '#f59e0b' : '#734A2A';
                const corVal    = abaixoMin ? '#f87171' : emAviso ? '#fbbf24' : '#4ade80';
                return (
                  <div key={i} style={{ background: '#4A2E1A', border: `2px solid ${corBorda}`, borderRadius: 14, padding: 16 }}>
                    <div style={{ fontWeight: 900, color: 'white', marginBottom: 8 }}>{item.produto}</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 900, color: corVal }}>
                      {item.estoqueAtual} <span style={{ fontSize: '0.85rem', color: '#D0B29E' }}>{item.unidade}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: '0.75rem', color: '#D0B29E', flexWrap: 'wrap' }}>
                      {item.saida24h != null && <span>24h: <b style={{ color: 'white' }}>{item.saida24h}</b></span>}
                      {item.saida48h != null && <span>48h: <b style={{ color: 'white' }}>{item.saida48h}</b></span>}
                      {item.mediaSaidaDiaria > 0 && <span>Média/dia: <b style={{ color: 'white' }}>{item.mediaSaidaDiaria.toFixed(0)}</b></span>}
                    </div>
                    {cobDias != null && (
                      <div style={{ marginTop: 8, padding: '5px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.7rem', color: '#D0B29E' }}>Cobertura</span>
                        <span style={{ fontWeight: 900, color: corVal }}>{cobDias < 0.1 ? '< 0.1' : cobDias.toFixed(1)} dias</span>
                      </div>
                    )}
                    {abaixoMin && <div style={{ marginTop: 8, background: '#5c1a1a', color: '#f87171', fontWeight: 800, fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, display: 'inline-block' }}>ABAIXO DO MÍNIMO</div>}
                    {emAviso && !abaixoMin && <div style={{ marginTop: 8, background: '#5c3a21', color: '#fbbf24', fontWeight: 800, fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, display: 'inline-block' }}>COBRE {cobDias.toFixed(1)} DIAS</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ABA 4 — ESTOQUE MP */}
        {aba === 'estoque_mp' && (
          <>
            <h3 style={S.h3}><i className="ph ph-package" style={{ color: '#F6BE00', marginRight: 8 }}></i>Estoque Matéria-Prima</h3>
            {estoqueMP.length > estoqueMPExibida.length && (
              <div style={{ textAlign: 'center', marginBottom: 14 }}>
                <button onClick={() => setMostrarTodosMP(v => !v)} style={{ background: 'transparent', border: '1px solid #734A2A', color: '#D0B29E', borderRadius: 20, padding: '6px 16px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>
                  {mostrarTodosMP ? `Mostrar só os insumos da produção de hoje (${estoqueMPFiltrado.length})` : `Mostrando insumos da produção de hoje · ver todos (${estoqueMP.length})`}
                </button>
              </div>
            )}
            {carregandoMP && <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>Carregando...</div>}
            {!carregandoMP && estoqueMP.length === 0 && (
              <div style={{ textAlign: 'center', color: '#D0B29E', padding: 40 }}>
                Nenhum item encontrado.<br />
                <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>Verifique a conexão com o sistema de estoque.</span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {estoqueMPExibida.map(item => {
                const abaixoMin = item.minimo > 0 && item.saldo <= item.minimo;
                const semEstoque = item.saldo <= 0;
                const corBorda = semEstoque ? '#dc2626' : abaixoMin ? '#f59e0b' : '#734A2A';
                const corSaldo = semEstoque ? '#f87171' : abaixoMin ? '#fbbf24' : '#4ade80';
                const percMin  = item.minimo > 0 ? Math.min(100, Math.round((item.saldo / item.minimo) * 100)) : null;
                return (
                  <div key={item.id} style={{ background: '#4A2E1A', border: `2px solid ${corBorda}`, borderRadius: 14, padding: 16 }}>
                    <div style={{ fontWeight: 700, color: 'white', marginBottom: 10, lineHeight: 1.3 }}>{item.nome}</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 900, color: corSaldo }}>
                      {item.saldo.toFixed(2)} <span style={{ fontSize: '0.85rem', color: '#D0B29E' }}>{item.unidade}</span>
                    </div>
                    {percMin != null && (
                      <>
                        <div style={{ marginTop: 8, background: '#3D2515', borderRadius: 20, height: 6, overflow: 'hidden' }}>
                          <div style={{ background: corSaldo, height: '100%', width: percMin + '%', transition: 'width 0.5s' }}></div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: '0.68rem', color: '#D0B29E' }}>
                          <span>{percMin}% do mínimo</span>
                          <span>Mín: {item.minimo} {item.unidade}</span>
                        </div>
                      </>
                    )}
                    {semEstoque && <div style={{ marginTop: 8, background: '#5c1a1a', color: '#f87171', fontWeight: 800, fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, display: 'inline-block' }}>SEM ESTOQUE</div>}
                    {!semEstoque && abaixoMin && <div style={{ marginTop: 8, background: '#5c3a21', color: '#fbbf24', fontWeight: 800, fontSize: '0.72rem', padding: '3px 10px', borderRadius: 20, display: 'inline-block' }}>ABAIXO DO MÍNIMO</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}

      </main>
    </div>
  );
}
