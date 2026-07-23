import { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot, collection, writeBatch, arrayUnion, getDocs, getDoc, increment, setDoc } from 'firebase/firestore';
import { db, dbEstoqueOS } from '../services/firebase';
import { hojeISO, formatarKg, formatarHoraData, formatarDataBR, somarDiasISO } from '../services/utils';
import { useAuth } from '../services/auth';
import { useProdutos, useMPOcultos } from '../services/hooks';
import { agoraServidor } from '../services/relogioServidor';
import { resumirOrigemMP } from '../services/consumoMP';
import ModalTeclado from '../components/ModalTeclado';

export default function Expedicao() {
  const { currentUser } = useAuth();
  const { produtos } = useProdutos();
  const dataHoje = hojeISO();
  const CHAVE_RASCUNHO = `patinhasPendentes_${dataHoje}`;
  const CHAVE_FORM_PESAGEM = `formPesagem_${dataHoje}`;
  // Data para a qual a patinha está sendo pesada — normalmente hoje, mas o
  // operador pode voltar pra um dia anterior que esqueceu de registrar.
  const [dataPesagem, setDataPesagem]       = useState(dataHoje);
  const pesandoRetroativo = dataPesagem !== dataHoje;
  function trocarDataPesagem(novaData) {
    setDataPesagem(novaData);
    setProdutoIdx('');
    setLote('');
    setValidade('');
  }
  const [producaoHoje, setProducaoHoje]     = useState([]);
  const [tunelHoje, setTunelHoje]           = useState([]);
  const [carregando, setCarregando]         = useState(true);
  const [listaEntrada, setListaEntrada]     = useState(() => {
    try {
      const salvo = localStorage.getItem(`patinhasPendentes_${hojeISO()}`);
      return salvo ? JSON.parse(salvo) : [];
    } catch { return []; }
  });
  const [salvando, setSalvando]             = useState(false);
  // Formulário de pesagem: restaurado do localStorage se a página recarregar
  // no meio do trabalho — só precisa selecionar de novo se for a 1ª vez.
  const formPesagemSalvo = (() => {
    try {
      const salvo = localStorage.getItem(CHAVE_FORM_PESAGEM);
      return salvo ? JSON.parse(salvo) : null;
    } catch { return null; }
  })();
  const [produtoIdx, setProdutoIdx]         = useState('');
  const [produtoRestaurar, setProdutoRestaurar] = useState(formPesagemSalvo?.produto || null);
  const [lote, setLote]                     = useState(formPesagemSalvo?.lote || '');
  const [qtd, setQtd]                       = useState('');
  const [und, setUnd]                       = useState(formPesagemSalvo?.und || 'kg');
  const [validade, setValidade]             = useState(formPesagemSalvo?.validade || '');
  const [nomeOperador, setNomeOperador]     = useState(localStorage.getItem('nomeOperador') || '');
  const [tecladoAberto, setTecladoAberto]   = useState(false);
  const [aba, setAba]                       = useState(0);
  const [estoqueAtual, setEstoqueAtual]     = useState([]);
  const [termoBuscaEstoque, setTermoBuscaEstoque] = useState('');
  const [modalLotesProduto, setModalLotesProduto] = useState(null);
  const [subAbaEstoque, setSubAbaEstoque]   = useState('acabado');
  const [estoqueMP, setEstoqueMP]           = useState([]);
  const [estoqueWinthor, setEstoqueWinthor] = useState({});
  const [carregandoMP, setCarregandoMP]     = useState(false);
  const mpOcultos = useMPOcultos();
  const [aviso, setAviso]                   = useState(null); // { tipo: 'ok'|'erro', texto }
  const [confirmSemRastreio, setConfirmSemRastreio] = useState(null); // { itemProg }
  const [edicaoPatinha, setEdicaoPatinha] = useState(null); // { idx, lote, validade, qtd }
  const avisoTimeoutRef = useRef(null);

  // Id estável por dispositivo/aba — cada operador pesando ao mesmo tempo
  // grava numa sub-sessão própria, sem sobrescrever a fila de outro.
  const [sessionId] = useState(() => {
    try {
      let id = localStorage.getItem('expedicaoSessionId');
      if (!id) { id = Date.now().toString(36) + Math.random().toString(36).slice(2); localStorage.setItem('expedicaoSessionId', id); }
      return id;
    } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
  });

  // Matéria Prima (original intacto)
  useEffect(() => {
    if (aba === 2 && subAbaEstoque === 'mp') {
      (async () => {
        setCarregandoMP(true);
        try {
          const winRef = await getDocs(collection(db, 'winthorEstoqueSistema'));
          const winthorData = {};
          winRef.forEach(d => { winthorData[d.id] = d.data().saldoWinthor || 0; });
          setEstoqueWinthor(winthorData);

          const cDoc = await getDoc(doc(dbEstoqueOS, 'global_settings', 'company_db'));
          if (cDoc.exists() && cDoc.data().masterUid) {
            const mUid = cDoc.data().masterUid;
            const [invS, batS] = await Promise.all([
              getDocs(collection(dbEstoqueOS, 'users', mUid, 'inventory')),
              getDocs(collection(dbEstoqueOS, 'users', mUid, 'batches'))
            ]);
            const batMap = {};
            batS.forEach(b => { const bd = b.data(); const pid = bd.productId || bd.item_id; if (!batMap[pid]) batMap[pid] = []; if ((bd.quantity || 0) > 0) batMap[pid].push({ id: b.id, ...bd }); });
            const mpList = [];
            invS.forEach(d => {
              const inv = d.data();
              mpList.push({ id: d.id, codigo: inv.code || d.id, nome: inv.name, und: inv.unit || 'kg', lotes: batMap[d.id] || [], totalFisico: (batMap[d.id] || []).reduce((acc, l) => acc + (parseFloat(l.quantity) || 0), 0) });
            });
            setEstoqueMP(mpList.sort((a, b) => a.nome.localeCompare(b.nome)));
          }
        } catch (e) { console.error('Erro MP:', e); }
        setCarregandoMP(false);
      })();
    }
  }, [aba, subAbaEstoque]);

  // Produção do dia sendo pesado (hoje, ou um dia anterior esquecido)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'producaoDiaria', dataPesagem), snap => {
      if (snap.exists()) { setProducaoHoje(snap.data().itens || []); setTunelHoje(snap.data().tunelRegistros || []); }
      else { setProducaoHoje([]); setTunelHoje([]); }
      setCarregando(false);
    });
    return unsub;
  }, [dataPesagem]);

  // Salva a fila de patinhas ainda não confirmadas — evita perder o
  // registro se a aba fechar/recarregar antes de "Confirmar Entrada".
  useEffect(() => {
    try {
      if (listaEntrada.length > 0) localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(listaEntrada));
      else localStorage.removeItem(CHAVE_RASCUNHO);
    } catch { /* localStorage indisponível — ignora */ }
  }, [listaEntrada, CHAVE_RASCUNHO]);

  // Assim que a produção do dia carrega, resolve o produto que estava
  // selecionado antes de uma recarga de página (guardado por nome/código).
  useEffect(() => {
    if (produtoRestaurar && producaoHoje.length > 0) {
      const idx = producaoHoje.findIndex(it => it.codigo === produtoRestaurar.codigo || it.produto === produtoRestaurar.nome);
      if (idx !== -1) setProdutoIdx(String(idx));
      setProdutoRestaurar(null);
    }
  }, [produtoRestaurar, producaoHoje]);

  // Mantém produto/lote/validade/unidade preenchidos entre uma patinha e
  // outra, e sobrevivem a um recarregamento acidental da página.
  useEffect(() => {
    try {
      const itemProg = produtoIdx !== '' ? producaoHoje[produtoIdx] : null;
      localStorage.setItem(CHAVE_FORM_PESAGEM, JSON.stringify({
        produto: itemProg ? { nome: itemProg.produto, codigo: itemProg.codigo } : null,
        lote, validade, und,
      }));
    } catch { /* localStorage indisponível — ignora */ }
  }, [produtoIdx, lote, validade, und, producaoHoje, CHAVE_FORM_PESAGEM]);

  // Espelha a mesma fila no Firestore, em tempo real, para o Painel TV
  // mostrar a patinha assim que ela é pesada — não só depois de confirmada.
  // O Firestore rejeita qualquer campo `undefined` (mesmo dentro de um
  // array), e a genealogia de MP pode conter algum campo assim — o
  // JSON.parse(JSON.stringify(...)) remove essas chaves antes de gravar.
  useEffect(() => {
    setDoc(doc(db, 'pesagensEmAndamento', dataHoje, 'sessoes', sessionId), {
      itens: JSON.parse(JSON.stringify(listaEntrada)),
      atualizadoEm: agoraServidor().toISOString(),
    }).catch(e => console.error('Erro ao sincronizar pesagem em andamento:', e));
  }, [listaEntrada, dataHoje, sessionId]);

  // Auto-preenche lote/validade do túnel — só quando o OPERADOR troca de
  // produto, nunca em atualizações de fundo. Antes isso tinha producaoHoje/
  // tunelHoje nas dependências, então toda vez que OUTRO operador batia uma
  // receita em qualquer lugar da fábrica (o que atualiza esses dados em
  // tempo real), o efeito rodava de novo e apagava o lote/validade que você
  // acabara de digitar no meio da pesagem.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (produtoIdx !== '') {
      const itemProg = producaoHoje[produtoIdx];
      if (itemProg) {
        const tunelItem = tunelHoje.slice().reverse().find(t => t.produto === itemProg.produto && t.lote);
        if (tunelItem?.lote) setLote(tunelItem.lote);
        if (tunelItem?.validade) setValidade(tunelItem.validade);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoIdx]);

  // Estoque físico PA (coleção 'estoque' — lotes individuais)
  useEffect(() => {
    if (aba === 2) {
      const unsub = onSnapshot(collection(db, 'estoque'), snap => {
        const est = [];
        snap.forEach(d => est.push({ ...d.data(), id: d.id }));
        setEstoqueAtual(est);
      });
      return unsub;
    }
  }, [aba]);

  // Aviso não-bloqueante (substitui alert()) — evita diálogos nativos
  // repetidos a cada patinha, que em alguns navegadores de tablet/kiosk
  // deixam a página em branco e exigem recarregar manualmente.
  function mostrarAviso(tipo, texto) {
    setAviso({ tipo, texto });
    clearTimeout(avisoTimeoutRef.current);
    avisoTimeoutRef.current = setTimeout(() => setAviso(null), 3500);
  }

  function commitPatinha(itemProg, origemMP) {
    setListaEntrada(prev => [...prev, {
      id:          Date.now().toString(36) + Math.random().toString(36).slice(2),
      operador:    nomeOperador.trim(),
      nome:        itemProg.produto,
      codigo:      itemProg.codigo,   // ← código Winthor linkado
      ops:         itemProg.ops || [],
      setor:       itemProg.categoria || 'Câmara',
      dataEntrada: dataPesagem,
      lote:        lote.trim(),
      qtd:         parseFloat(qtd),
      und,
      validade,
      origemMP,                       // ← NOVO: genealogia dos lotes de MP
      timestamp:   agoraServidor().toISOString(),
    }]);
    setQtd('');
    mostrarAviso('ok', 'Patinha adicionada para conferência!');
  }

  function abrirEdicaoPatinha(idx) {
    const item = listaEntrada[idx];
    setEdicaoPatinha({ idx, lote: item.lote, validade: item.validade || '', qtd: String(item.qtd) });
  }

  function confirmarEdicaoPatinha() {
    if (!nomeOperador.trim()) return mostrarAviso('erro', 'Informe seu nome antes de editar.');
    const { idx, lote: loteNovo, validade: validadeNova, qtd: qtdNova } = edicaoPatinha;
    const qtdNum = parseFloat(qtdNova);
    if (!qtdNova || isNaN(qtdNum) || qtdNum <= 0) return mostrarAviso('erro', 'Peso inválido.');
    if (!loteNovo.trim()) return mostrarAviso('erro', 'Informe o lote.');

    setListaEntrada(prev => {
      const nova = [...prev];
      const original = nova[idx];
      const mudancas = [];
      if (original.lote !== loteNovo.trim()) mudancas.push(`lote ${original.lote} → ${loteNovo.trim()}`);
      if ((original.validade || '') !== validadeNova) mudancas.push(`validade ${original.validade || 's/data'} → ${validadeNova || 's/data'}`);
      if (original.qtd !== qtdNum) mudancas.push(`peso ${formatarKg(original.qtd)} → ${formatarKg(qtdNum)} ${original.und}`);

      nova[idx] = {
        ...original,
        lote: loteNovo.trim(),
        validade: validadeNova,
        qtd: qtdNum,
        ...(mudancas.length > 0 ? {
          ultimaEdicao: { por: nomeOperador.trim(), em: agoraServidor().toISOString(), mudancas: mudancas.join(', ') },
        } : {}),
      };
      return nova;
    });
    setEdicaoPatinha(null);
  }

  function adicionarPatinha() {
    if (produtoIdx === '') return mostrarAviso('erro', 'Selecione um produto!');
    if (!qtd || qtd <= 0) return mostrarAviso('erro', 'Insira um peso válido!');
    if (!lote.trim()) return mostrarAviso('erro', 'Insira o lote físico!');
    if (!nomeOperador.trim()) return mostrarAviso('erro', 'Informe seu nome!');
    localStorage.setItem('nomeOperador', nomeOperador.trim());
    const itemProg = producaoHoje[produtoIdx];

    // ── Genealogia: puxa os lotes de MP consumidos nas batidas deste item ──
    // É aqui que a corrente se fecha: farinha → batida → esta patinha de PA.
    const origemMP = resumirOrigemMP(itemProg.consumoMP);

    if (!origemMP) {
      setConfirmSemRastreio({ itemProg });
      return;
    }

    commitPatinha(itemProg, origemMP);
  }

  async function salvarEntradas() {
    if (listaEntrada.length === 0) return;
    setSalvando(true);
    try {
      const batch = writeBatch(db);

      listaEntrada.forEach(item => {
        // O Firestore rejeita qualquer campo `undefined`, mesmo dentro de
        // objetos aninhados — a genealogia de MP pode ter algum campo assim
        // dependendo de como a batida foi registrada. Sanitiza uma vez aqui.
        const origemMPLimpa = item.origemMP ? JSON.parse(JSON.stringify(item.origemMP)) : null;

        // ── 1. Lote individual no estoque físico (colecão original) ──
        const refEst = doc(collection(db, 'estoque'));
        batch.set(refEst, {
          nome:        item.nome,
          codigo:      item.codigo,
          setor:       item.setor,
          lote:        item.lote,
          qtd:         item.qtd,
          und:         item.und,
          validade:    item.validade,
          dataEntrada: item.dataEntrada,
          ops:         item.ops,
          origemMP:    origemMPLimpa,   // ← genealogia MP
          ultimaEdicao: item.ultimaEdicao || null,   // ← auditoria: quem/quando/o quê mudou antes de confirmar
          isTeste:     false,
        });

        // ── 2. Movimento de entrada (original) ──
        const refMov = doc(collection(db, 'movimentos'));
        batch.set(refMov, {
          tipo:    'ENTRADA',
          nome:    item.nome,
          codigo:  item.codigo,
          lote:    item.lote,
          qtd:     item.qtd,
          und:     item.und,
          data:    agoraServidor().toISOString(),
          usuario: item.operador,
        });

        // ── 3. Expedição diária (original) ──
        const refExp = doc(db, 'expedicaoDiaria', item.dataEntrada || dataHoje);
        const regExp = {
          id:             Date.now().toString() + Math.random(),
          codigoProduto:  item.codigo,
          produto:        item.nome,
          ops:            item.ops,
          lote:           item.lote,
          pesoTotal:      item.qtd,
          qtCaixas:       1,
          horario:        formatarHoraData(agoraServidor().toISOString()),
          timestamp:      agoraServidor().toISOString(),
        };
        batch.set(refExp, { data: item.dataEntrada || dataHoje, registros: arrayUnion(regExp) }, { merge: true });

        // ── 4. NOVO: saldo físico PA por código (estoquePAFisico) ──
        // Documento principal: saldo agregado por produto
        if (item.codigo) {
          const refSaldo = doc(db, 'estoquePAFisico', item.codigo);
          batch.set(refSaldo, {
            codigo:       item.codigo,
            produto:      item.nome,
            saldoFisico:  increment(item.qtd),
            unidade:      item.und,
            ultimaEntrada: agoraServidor().toISOString(),
          }, { merge: true });

          // Sub-coleção: lotes individuais rastreáveis
          const refLote = doc(collection(db, 'estoquePAFisico', item.codigo, 'lotes'));
          batch.set(refLote, {
            lote:         item.lote,
            qtd:          item.qtd,
            und:          item.und,
            validade:     item.validade,
            dataEntrada:  item.dataEntrada,
            ops:          item.ops,
            operador:     item.operador,
            ativo:        true,   // false quando consumido/ajustado

            // ── GENEALOGIA: de quais lotes de MP este lote de PA veio ──
            // Fecha a rastreabilidade ponta a ponta:
            //   lote de farinha → batida → este lote de PA → cliente
            origemMP:        origemMPLimpa,
            rastreioCompleto: !!item.origemMP && !item.origemMP.incompleto,
            ultimaEdicao:    item.ultimaEdicao || null,

            registradoEm: agoraServidor().toISOString(),
          });
        }
      });

      await batch.commit();
      mostrarAviso('ok', `${listaEntrada.length} patinhas registradas na câmara!`);
      setListaEntrada([]);
      try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* ignora */ }
      setQtd('');
      setAba(2);
    } catch (e) {
      mostrarAviso('erro', e.message);
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <div className="status-msg">Buscando produção de hoje...</div>;

  const isPcp = currentUser?.setor === 'pcp';

  // Agrupamento estoque físico acabado
  const gruposAcabado = {};
  estoqueAtual.forEach(it => {
    if (!gruposAcabado[it.nome]) gruposAcabado[it.nome] = { nome: it.nome, codigo: it.codigo, totalKg: 0, totalUnd: 0, lotes: [], und: it.und };
    if (it.und === 'kg') gruposAcabado[it.nome].totalKg += parseFloat(it.qtd || 0);
    else gruposAcabado[it.nome].totalUnd += parseFloat(it.qtd || 0);
    gruposAcabado[it.nome].lotes.push(it);
  });
  let listaAcabado = Object.values(gruposAcabado);
  let mpFiltrado = estoqueMP.filter(g => !mpOcultos[g.codigo]);
  if (termoBuscaEstoque) {
    const t = termoBuscaEstoque.toLowerCase();
    listaAcabado = listaAcabado.filter(g => g.nome.toLowerCase().includes(t));
    mpFiltrado = mpFiltrado.filter(g => g.nome.toLowerCase().includes(t) || (g.codigo && g.codigo.toLowerCase().includes(t)));
  }

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid var(--border-suave)' }}>
        <h2 style={{ fontWeight: 900, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="ph ph-snowflake" style={{ fontSize: '1.8rem', color: 'var(--amarelo)' }}></i>Expedição / Câmaras
        </h2>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
        <button className={'btn' + (aba === 0 ? ' btn-primary' : ' btn-outline')} onClick={() => setAba(0)} style={{ borderRadius: 50, padding: '8px 20px', whiteSpace: 'nowrap' }}>Pesagem</button>
        <button className={'btn' + (aba === 1 ? ' btn-primary' : ' btn-outline')} onClick={() => setAba(1)} style={{ borderRadius: 50, padding: '8px 20px', whiteSpace: 'nowrap' }}>Conferência ({listaEntrada.length})</button>
      </div>

      {/* ── Aba Pesagem ── */}
      {aba === 0 && (
        <div className="card">
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>
              Data da pesagem
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-outline" style={{ padding: '10px 14px' }} onClick={() => trocarDataPesagem(somarDiasISO(dataPesagem, -1))}>‹</button>
              <input
                type="date"
                className="input-texto"
                style={{ flex: 1, textAlign: 'center', fontWeight: 700 }}
                max={dataHoje}
                value={dataPesagem}
                onChange={e => e.target.value && trocarDataPesagem(e.target.value)}
              />
              <button type="button" className="btn btn-outline" style={{ padding: '10px 14px' }} disabled={dataPesagem >= dataHoje} onClick={() => trocarDataPesagem(somarDiasISO(dataPesagem, 1))}>›</button>
              {pesandoRetroativo && (
                <button type="button" className="btn btn-primary" style={{ padding: '10px 14px', whiteSpace: 'nowrap' }} onClick={() => trocarDataPesagem(dataHoje)}>Hoje</button>
              )}
            </div>
            {pesandoRetroativo && (
              <div style={{ marginTop: 8, background: 'var(--warning-soft, #fef3c7)', color: '#92400e', borderRadius: 8, padding: '8px 12px', fontSize: '0.78rem', fontWeight: 700 }}>
                <i className="ph ph-clock-counter-clockwise" style={{ marginRight: 6 }}></i>
                Registrando uma patinha esquecida de {formatarDataBR(dataPesagem)} — não é a pesagem de hoje.
              </div>
            )}
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Responsável</label>
            <input className="input-texto" value={nomeOperador} onChange={e => setNomeOperador(e.target.value)} placeholder="Seu nome" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Produto Programado</label>
            <select className="input-texto" value={produtoIdx} onChange={e => setProdutoIdx(e.target.value)} style={{ padding: 14 }}>
              <option value="">Selecione...</option>
              {producaoHoje.map((it, i) => (
                <option key={i} value={i}>
                  {it.produto}{it.codigo ? ` [${it.codigo}]` : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Lote Físico</label>
              <input className="input-texto" value={lote} onChange={e => setLote(e.target.value)} placeholder="Ex: L-0307" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Validade</label>
              <input type="date" className="input-texto" value={validade} onChange={e => setValidade(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--amarelo)', marginBottom: 6 }}>Peso da Patinha</label>
              <button className="input-texto" style={{ textAlign: 'left', fontWeight: 900, fontSize: '1.1rem', padding: 16, border: '2px solid var(--amarelo)', cursor: 'pointer' }} onClick={() => setTecladoAberto(true)}>
                {qtd ? `${formatarKg(qtd)} ${und}` : 'Tocar para digitar peso...'}
              </button>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Unidade</label>
              <select className="input-texto" value={und} onChange={e => setUnd(e.target.value)} style={{ padding: 16 }}>
                <option value="kg">kg</option>
                <option value="und">und</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-block" onClick={adicionarPatinha}>
            <i className="ph ph-plus-circle" style={{ marginRight: 8 }}></i>Adicionar à Conferência
          </button>
        </div>
      )}

      {/* ── Aba Conferência ── */}
      {aba === 1 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
            <h3 className="nome">Conferência de Patinhas</h3>
            <div style={{ display: 'flex', gap: 10 }}>
              <span style={{ background: '#eef2ff', color: '#3730a3', padding: '6px 14px', borderRadius: 10, fontWeight: 900, fontSize: '0.9rem' }}>
                {listaEntrada.length} pesagem{listaEntrada.length !== 1 ? 's' : ''}
              </span>
              <span style={{ background: 'var(--amarelo-claro)', color: 'var(--marrom)', padding: '6px 14px', borderRadius: 10, fontWeight: 900, fontSize: '0.9rem' }}>
                Total: {listaEntrada.reduce((acc, item) => acc + (item.und === 'kg' ? item.qtd : 0), 0).toFixed(2)} kg
              </span>
            </div>
          </div>
          {listaEntrada.length === 0
            ? <div className="status-msg">Nenhuma patinha na lista.</div>
            : <div>
                {listaEntrada.map((item, idx) => (
                  <div key={idx} style={{ padding: 14, background: '#fafafa', border: '1px solid var(--border-suave)', borderRadius: 14, marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--marrom)' }}>{item.nome}</div>
                        <div style={{ fontSize: '0.78rem', color: '#999', marginTop: 2 }}>
                          Lote: {item.lote} | Val: {item.validade}
                          {item.codigo && <span style={{ marginLeft: 8, background: 'var(--amarelo-claro)', color: 'var(--marrom)', padding: '1px 7px', borderRadius: 8, fontWeight: 700 }}>COD {item.codigo}</span>}
                          {item.ops?.length > 0 && <span style={{ marginLeft: 6, color: '#a78355' }}>OP: {item.ops.join(', ')}</span>}
                        </div>
                        {item.timestamp && (
                          <div style={{ fontSize: '0.72rem', color: '#a78355', marginTop: 2, fontWeight: 600 }}>
                            <i className="ph ph-clock" style={{ marginRight: 4 }}></i>Pesado às {formatarHoraData(item.timestamp)}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontWeight: 900, color: 'var(--amarelo)', fontSize: '1.1rem' }}>{formatarKg(item.qtd)} {item.und}</span>
                        <button onClick={() => abrirEdicaoPatinha(idx)} title="Editar" style={{ background: 'var(--amarelo-claro)', border: '1px solid var(--amarelo)', borderRadius: 8, padding: '6px 8px', cursor: 'pointer' }}>
                          <i className="ph ph-pencil-simple"></i>
                        </button>
                        <button className="remover-btn" onClick={() => setListaEntrada(prev => prev.filter((_, i) => i !== idx))}>✕</button>
                      </div>
                    </div>
                    {item.ultimaEdicao && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border-suave)', fontSize: '0.66rem', color: '#a78355' }}>
                        <i className="ph ph-note-pencil" style={{ marginRight: 4 }}></i>
                        Editado por {item.ultimaEdicao.por} às {formatarHoraData(item.ultimaEdicao.em)} — {item.ultimaEdicao.mudancas}
                      </div>
                    )}
                  </div>
                ))}
              </div>
          }
          {listaEntrada.length > 0 && (
            <button
              className="btn btn-block"
              style={{ marginTop: 14, background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }}
              onClick={salvarEntradas}
              disabled={salvando}
            >
              {salvando ? 'Salvando...' : '✓ Confirmar Entrada na Câmara'}
            </button>
          )}
        </div>
      )}

      {tecladoAberto && (
        <ModalTeclado
          titulo="Peso da Patinha"
          valorInicial={qtd}
          aoConfirmar={v => { setQtd(v); setTecladoAberto(false); }}
          aoFechar={() => setTecladoAberto(false)}
        />
      )}

      {/* ── Editar patinha (lote, validade, peso) antes de confirmar a entrada ── */}
      {edicaoPatinha && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }} onClick={() => setEdicaoPatinha(null)}>
          <div style={{ background: 'white', width: '100%', maxWidth: 480, margin: '0 auto', borderRadius: '20px 20px 0 0', padding: 22 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--marrom)' }}>Editar patinha</div>
              <button onClick={() => setEdicaoPatinha(null)} style={{ background: 'none', border: 'none', fontSize: '1.3rem', color: '#999', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Lote Físico</label>
                <input className="input-texto" value={edicaoPatinha.lote} onChange={e => setEdicaoPatinha({ ...edicaoPatinha, lote: e.target.value })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Validade</label>
                <input type="date" className="input-texto" value={edicaoPatinha.validade} onChange={e => setEdicaoPatinha({ ...edicaoPatinha, validade: e.target.value })} />
              </div>
            </div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Peso (kg)</label>
            <input type="number" step="0.01" className="input-texto" value={edicaoPatinha.qtd} onChange={e => setEdicaoPatinha({ ...edicaoPatinha, qtd: e.target.value })} style={{ marginBottom: 14 }} />
            <div style={{ fontSize: '0.72rem', color: '#999', marginBottom: 16 }}>
              A alteração fica registrada com seu nome ({nomeOperador || 'informe o nome na aba Pesagem'}) e o horário.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline btn-block" onClick={() => setEdicaoPatinha(null)}>Cancelar</button>
              <button className="btn btn-primary btn-block" onClick={confirmarEdicaoPatinha}>Salvar edição</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmação de patinha sem rastreio de MP (substitui window.confirm) ── */}
      {confirmSemRastreio && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }} onClick={() => setConfirmSemRastreio(null)}>
          <div style={{ background: 'white', width: '100%', maxWidth: 480, margin: '0 auto', borderRadius: '20px 20px 0 0', padding: 22 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 900, fontSize: '1.05rem', color: '#b91c1c', marginBottom: 10 }}>⚠️ Sem rastreio de matéria-prima</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--marrom)', lineHeight: 1.5, marginBottom: 18 }}>
              "{confirmSemRastreio.itemProg.produto}" não tem nenhum consumo de MP registrado nas batidas de hoje.
              Este lote de PA entrará na câmara <strong>sem genealogia</strong> — não será possível saber de quais lotes de farinha ele veio.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline btn-block" onClick={() => setConfirmSemRastreio(null)}>Cancelar</button>
              <button
                className="btn btn-primary btn-block"
                onClick={() => { commitPatinha(confirmSemRastreio.itemProg, null); setConfirmSemRastreio(null); }}
              >
                Adicionar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Aviso não-bloqueante (substitui alert()) ── */}
      {aviso && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 10000,
          background: aviso.tipo === 'erro' ? '#b91c1c' : '#15803d', color: 'white',
          padding: '12px 20px', borderRadius: 12, fontWeight: 700, fontSize: '0.88rem',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)', maxWidth: '90vw', textAlign: 'center',
        }}>
          {aviso.texto}
        </div>
      )}
    </div>
  );
}
