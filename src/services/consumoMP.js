import { collection, getDocs, getDoc, doc, writeBatch, increment, setDoc } from 'firebase/firestore';
import { db, dbEstoqueOS } from './firebase';

// ── Normalização de texto (compara nomes ignorando acentos/caixa/pontuação) ──
function normalizar(txt) {
  return (txt || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // remove acentos
    .replace(/[^a-z0-9\s]/gi, ' ')      // pontuação vira espaço (ex: "FAR." → "FAR ")
    .replace(/\s+/g, ' ')               // colapsa espaços
    .toLowerCase()
    .trim();
}

// Palavras que não ajudam a identificar o produto (ruído de cadastro do Winthor)
const STOPWORDS = new Set([
  'pao', 'de', 'da', 'do', 'com', 'e', 'a', 'o', 'kg', 'g', 'un', 'und', 'unid',
  'cx', 'pct', 'congelado', 'congelados', 'resfriado', 'fatiado', 'sem', 'tipo',
]);

function tokens(txt) {
  return normalizar(txt).split(' ').filter(t => t && !STOPWORDS.has(t));
}

function normalizarCodigo(cod) {
  return (cod ?? '').toString().trim().replace(/^0+(?=\d)/, ''); // tira zeros à esquerda
}

// ── Multi-tenant: os dados reais moram em users/{masterUid}/..., não na raiz.
// (mesmo padrão já usado em Expedicao.jsx para inventory/batches). Ler a raiz
// direto é o que causava "Missing or insufficient permissions" — as regras do
// Firestore só liberam a subcoleção do masterUid. ──
let cacheMasterUid = null;
let cacheMasterUidEm = 0;

async function obterMasterUid() {
  const agora = Date.now();
  if (cacheMasterUid && (agora - cacheMasterUidEm) < TTL_CACHE_MS) return cacheMasterUid;
  const cDoc = await getDoc(doc(dbEstoqueOS, 'global_settings', 'company_db'));
  if (!cDoc.exists() || !cDoc.data().masterUid) {
    throw new Error('Configuração da empresa (masterUid) não encontrada em global_settings/company_db.');
  }
  cacheMasterUid = cDoc.data().masterUid;
  cacheMasterUidEm = agora;
  return cacheMasterUid;
}

// ── Cache em memória — evita reler `recipes` e `inventory` a cada +1 ──
let cacheReceitas = null;
let cacheReceitasEm = 0;
let cacheInventory = null;
let cacheInventoryEm = 0;

// ── Cache de batches (lotes de MP) ──────────────────────────────────
// PROBLEMA ANTERIOR: cada +1 fazia 1 getDocs(batches) POR ingrediente da receita.
// Uma receita com 8 ingredientes = 8 leituras por clique = 1.040 leituras em 130 batidas.
//
// SOLUÇÃO: carrega TODOS os batches de uma vez e mantém em memória.
// Após um consumo, só invalida os productIds que foram alterados — na próxima
// chamada, recarrega apenas esses. O resto do cache continua válido.
//
// Resultado: 1 clique = 0 leituras de batches (cache hit) + 1 writeBatch.
let cacheBatches = null;        // Map<productId, Batch[]>
let cacheBatchesEm = 0;
const TTL_CACHE_MS = 10 * 60 * 1000; // 10 minutos
const produtosInvalidados = new Set(); // productIds com saldo alterado desde o último load

async function carregarTodosBatches() {
  const agora = Date.now();

  // Recarrega se: cache vazio, TTL expirou, ou há produtos invalidados
  if (!cacheBatches || (agora - cacheBatchesEm) >= TTL_CACHE_MS || produtosInvalidados.size > 0) {
    const mUid = await obterMasterUid();
    const snap = await getDocs(collection(dbEstoqueOS, 'users', mUid, 'batches'));
    const mapa = new Map();
    snap.forEach(d => {
      const dados = d.data();
      const pid = dados.productId;
      if (!pid) return;
      if (!mapa.has(pid)) mapa.set(pid, []);
      if ((dados.quantity || 0) > 0) mapa.get(pid).push({ id: d.id, ...dados });
    });
    cacheBatches = mapa;
    cacheBatchesEm = agora;
    produtosInvalidados.clear();
  }

  return cacheBatches;
}

function lotesDoIngrediente(batchesMap, productId) {
  return batchesMap.get(productId) || [];
}

// Atualiza o cache local após um consumo, sem precisar reler o Firestore
function atualizarCacheAposConsumo(consumos) {
  if (!cacheBatches) return;
  consumos.forEach(c => {
    c.lotes.forEach(l => {
      const lista = cacheBatches.get(c.productId);
      if (!lista) return;
      const lote = lista.find(b => b.id === l.loteId);
      if (lote) {
        lote.quantity = Math.max(0, (lote.quantity || 0) - l.quantidade);
      }
    });
  });
}

function atualizarCacheAposReversao(consumoRegistrado) {
  if (!cacheBatches || !consumoRegistrado?.consumos) return;
  consumoRegistrado.consumos.forEach(c => {
    c.lotes?.forEach(l => {
      const lista = cacheBatches.get(c.productId);
      if (!lista) return;
      const lote = lista.find(b => b.id === l.loteId);
      if (lote) {
        lote.quantity = (lote.quantity || 0) + l.quantidade;
      }
    });
  });
}

async function carregarReceitas() {
  const agora = Date.now();
  if (cacheReceitas && (agora - cacheReceitasEm) < TTL_CACHE_MS) return cacheReceitas;
  const mUid = await obterMasterUid();
  const snap = await getDocs(collection(dbEstoqueOS, 'users', mUid, 'recipes'));
  const lista = [];
  snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
  cacheReceitas = lista;
  cacheReceitasEm = agora;
  return lista;
}

async function carregarInventoryMap() {
  const agora = Date.now();
  if (cacheInventory && (agora - cacheInventoryEm) < TTL_CACHE_MS) return cacheInventory;
  const mUid = await obterMasterUid();
  const snap = await getDocs(collection(dbEstoqueOS, 'users', mUid, 'inventory'));
  const mapa = {};
  snap.forEach(d => { mapa[d.id] = { id: d.id, ...d.data() }; });
  cacheInventory = mapa;
  cacheInventoryEm = agora;
  return mapa;
}

// Força recarregar tudo na próxima chamada
export function invalidarCacheReceitas() {
  cacheReceitas = null;
  cacheInventory = null;
  cacheBatches = null;
  cacheReceitasEm = 0;
  cacheInventoryEm = 0;
  cacheBatchesEm = 0;
  produtosInvalidados.clear();
}

// Acesso público ao mapa de insumos (usado pela UI de troca de lote)
export async function obterInventoryMap() {
  return carregarInventoryMap();
}

// ── Encontra a ficha técnica de um produto — CÓDIGO OFICIAL primeiro ──
// O código do Winthor é a chave confiável (não muda, não tem sinônimo).
// O nome só entra como fallback por assimilação, para receitas que ainda
// não foram vinculadas por código no cadastro.
//
// Ordem de busca:
//   1) receita.codigo === código oficial do Winthor        (vínculo forte)
//   2) nome — igualdade exata (normalizada)
//   3) nome — um contém o outro ("pao frances" ⊂ "pao frances 50g")
//   4) nome — todas as palavras-chave do produto batem na receita
export async function buscarReceitaPorCodigoOuNome(codigo, nomeProduto) {
  const receitas = await carregarReceitas();

  // Nível 1 — código oficial (Winthor). Aceita variações de campo
  // (codigo/codigoWinthor/code) porque o cadastro pode ter evoluído.
  const codAlvo = normalizarCodigo(codigo);
  if (codAlvo) {
    const porCodigo = receitas.find(r => {
      const candidatos = [r.codigo, r.codigoWinthor, r.code].map(normalizarCodigo);
      return candidatos.includes(codAlvo);
    });
    if (porCodigo) return { receita: porCodigo, vinculo: 'codigo' };
  }

  if (!nomeProduto) return { receita: null, vinculo: null };
  const receitasNome = receitas;
  const alvo = normalizar(nomeProduto);
  if (!alvo) return { receita: null, vinculo: null };

  // Nível 2 — igualdade exata (normalizada)
  const exata = receitasNome.find(r => normalizar(r.name) === alvo);
  if (exata) return { receita: exata, vinculo: 'nome_exato' };

  // Nível 3 — um nome contém o outro ("pao frances" ⊂ "pao frances 50g")
  const contida = receitasNome.find(r => {
    const n = normalizar(r.name);
    return n && (n.includes(alvo) || alvo.includes(n));
  });
  if (contida) return { receita: contida, vinculo: 'nome_parcial' };

  // Nível 4 — melhor sobreposição de palavras significativas.
  // Exige que TODAS as palavras-chave do produto estejam na receita
  // (evita casar "PAO FRANCES" com "PAO DE QUEIJO" por acaso).
  const tokensAlvo = tokens(nomeProduto);
  if (tokensAlvo.length === 0) return { receita: null, vinculo: null };

  let melhor = null;
  let melhorScore = 0;
  for (const r of receitasNome) {
    const tokensReceita = new Set(tokens(r.name));
    if (tokensReceita.size === 0) continue;
    const acertos = tokensAlvo.filter(t => tokensReceita.has(t)).length;
    const score = acertos / tokensAlvo.length;
    if (score > melhorScore) { melhorScore = score; melhor = r; }
  }
  // Só aceita se casou TODAS as palavras-chave do produto
  if (melhorScore >= 1) return { receita: melhor, vinculo: 'nome_assimilado' };
  return { receita: null, vinculo: null };
}

// Retrocompatível: mesma assinatura antiga, só por nome (sem código).
export async function buscarReceitaPorNomeProduto(nomeProduto) {
  const { receita } = await buscarReceitaPorCodigoOuNome(null, nomeProduto);
  return receita;
}

// ── Diagnóstico: por que um produto não achou receita? ──────────────
// Usado pela UI para mostrar um aviso útil ao operador em vez de falhar em silêncio.
export async function diagnosticarProduto(nomeProduto, codigo = null) {
  let receita, vinculo;
  try {
    ({ receita, vinculo } = await buscarReceitaPorCodigoOuNome(codigo, nomeProduto));
  } catch (e) {
    return {
      ok: false,
      motivo: 'ERRO_LEITURA',
      mensagem: `Falha ao ler a ficha técnica: ${e.message}`,
    };
  }

  if (!receita) {
    return {
      ok: false,
      motivo: 'SEM_RECEITA',
      mensagem: codigo
        ? `Nenhuma ficha técnica encontrada para "${nomeProduto}" (código ${codigo}). A matéria-prima NÃO está sendo baixada.`
        : `Nenhuma ficha técnica encontrada para "${nomeProduto}". A matéria-prima NÃO está sendo baixada.`,
    };
  }
  if (!receita.ingredients?.length) {
    return {
      ok: false,
      receita,
      motivo: 'RECEITA_VAZIA',
      mensagem: `A ficha técnica "${receita.name}" não tem ingredientes cadastrados.`,
    };
  }
  const farinhas = await identificarIngredientesFarinha(receita);
  if (farinhas.length === 0) {
    return {
      ok: true,
      receita,
      vinculo,
      motivo: 'SEM_FARINHA',
      mensagem: `A receita "${receita.name}" não tem nenhum insumo marcado como trocável pelo operador.`,
    };
  }
  return { ok: true, receita, vinculo, farinhas, motivo: null, mensagem: null };
}

// ── Identifica insumos que o operador pode trocar manualmente ───────
// ANTES: `nome.includes('farinha')` hardcoded → não pegava "FAR. MEDALHA DE OURO",
// "TRIGO ESPECIAL", etc, e quebrava sempre que o cadastro mudava.
// AGORA: prioriza um flag explícito no `inventory`, e só cai na heurística
// de nome se ninguém tiver marcado nada.
//
//   👉 Recomendado: no Firestore, em `inventory/{id}`, adicione:
//        trocavelPeloOperador: true
//      nos insumos que o operador abre saco a saco (farinhas, principalmente).
const PALAVRAS_FARINHA = ['farinha', 'far', 'trigo'];

function pareceFarinha(nome) {
  const t = tokens(nome);
  return t.some(tok => PALAVRAS_FARINHA.includes(tok));
}

export async function identificarIngredientesFarinha(receita) {
  if (!receita?.ingredients?.length) return [];
  const inventoryMap = await carregarInventoryMap();

  const candidatos = receita.ingredients.map(ing => {
    const info = inventoryMap[ing.productId] || {};
    return {
      productId: ing.productId,
      nome: info.name || 'Insumo desconhecido',
      unidade: info.unit || 'kg',
      trocavel: info.trocavelPeloOperador === true,
    };
  });

  // 1º) Se algum insumo foi explicitamente marcado, respeita só os marcados.
  const marcados = candidatos.filter(c => c.trocavel);
  if (marcados.length > 0) return marcados;

  // 2º) Senão, cai na heurística de nome (retrocompatível).
  return candidatos.filter(c => pareceFarinha(c.nome));
}

// ── Lista os lotes disponíveis de um insumo, em ordem FEFO ──────────
export async function listarLotesDisponiveis(productId) {
  const batchesMap = await carregarTodosBatches();
  const lotes = lotesDoIngrediente(batchesMap, productId).filter(l => (l.quantity || 0) > 0);
  return ordenarFEFO(lotes);
}

// FEFO: validade crescente. Lotes sem validade vão para o FIM da fila
// (não se consome às cegas um lote sem data quando há lotes datados vencendo).
function ordenarFEFO(lotes) {
  return [...lotes].sort((a, b) => {
    const va = a.expiryDate || a.validade || '9999-12-31';
    const vb = b.expiryDate || b.validade || '9999-12-31';
    return String(va).localeCompare(String(vb));
  });
}

function numeroDoLote(lote) {
  return lote.batchNumber || lote.code || lote.number || lote.id;
}

// ── Define manualmente qual lote de um insumo deve ser usado agora ──
// BUG CORRIGIDO: usava updateDoc com caminho pontilhado (`lotesForcados.${productId}`).
// Isso estourava se (a) o doc do dia ainda não existisse, ou (b) o productId
// contivesse um ponto. Agora usa setDoc + merge com objeto aninhado.
export async function definirLoteForcado(dataISO, productId, lote, operador) {
  await setDoc(
    doc(db, 'producaoDiaria', dataISO),
    {
      lotesForcados: {
        [productId]: {
          loteId: lote.id,
          loteNumero: numeroDoLote(lote),
          validade: lote.expiryDate || lote.validade || null,
          selecionadoEm: new Date().toISOString(),
          selecionadoPor: operador || null,
        },
      },
    },
    { merge: true }
  );
}

// ── Consome os ingredientes de uma receita via FEFO ─────────────────
// receita       — ficha técnica (com .ingredients e, idealmente, .yield/.rendimento)
// multiplicador — quantas receitas essa batida representa (default 1)
// lotesForcados — { [productId]: { loteId, ... } } override manual do operador
// contexto      — { numeroOP, produto, operador } → gravado para rastreabilidade
//
// O lote forçado fura a fila; se acabar no meio da batelada, o sistema
// completa automaticamente com o próximo lote em ordem FEFO.
export async function consumirIngredientesFEFO(receita, multiplicador = 1, lotesForcados = {}, contexto = {}) {
  const mUid = await obterMasterUid();
  const inventoryMap = await carregarInventoryMap();

  // Carrega TODOS os batches de uma vez (cache — zero leituras se já carregado)
  const batchesMap = await carregarTodosBatches();

  const consumos = [];
  let incompleto = false;

  for (const ingrediente of (receita.ingredients || [])) {
    const necessario = (ingrediente.quantity || 0) * multiplicador;
    if (necessario <= 0) continue;

    const infoMP = inventoryMap[ingrediente.productId] || { name: 'Insumo desconhecido', unit: 'kg' };

    // Lotes do ingrediente — vêm do cache, sem leitura ao Firestore
    const lotes = lotesDoIngrediente(batchesMap, ingrediente.productId).filter(l => (l.quantity || 0) > 0);

    let filaConsumo = ordenarFEFO(lotes);

    const forcado = lotesForcados?.[ingrediente.productId];
    if (forcado?.loteId) {
      const idx = filaConsumo.findIndex(l => l.id === forcado.loteId);
      if (idx > 0) {
        const [loteForcado] = filaConsumo.splice(idx, 1);
        filaConsumo = [loteForcado, ...filaConsumo];
      }
    }

    let restante = necessario;
    const consumidosDesteIngrediente = [];

    for (const lote of filaConsumo) {
      if (restante <= 0.0001) break;
      const disponivel = lote.quantity || 0;
      const retirar = Math.min(disponivel, restante);
      if (retirar <= 0) continue;
      consumidosDesteIngrediente.push({
        loteId: lote.id,
        loteNumero: numeroDoLote(lote),
        validade: lote.expiryDate || lote.validade || null,
        quantidade: retirar,
        forcadoManualmente: forcado?.loteId === lote.id,
      });
      restante -= retirar;
    }

    if (restante > 0.0001) incompleto = true;

    consumos.push({
      productId: ingrediente.productId,
      nomeMP: infoMP.name,
      unidade: infoMP.unit || 'kg',
      necessario,
      atendido: necessario - restante,
      faltou: restante > 0.0001 ? restante : 0,
      lotes: consumidosDesteIngrediente,
    });
  }

  // Grava os descontos em batch — 1 operação atômica no Firestore
  const batch = writeBatch(dbEstoqueOS);
  let houveEscrita = false;
  consumos.forEach(c => {
    c.lotes.forEach(l => {
      batch.update(doc(dbEstoqueOS, 'users', mUid, 'batches', l.loteId), { quantity: increment(-l.quantidade) });
      houveEscrita = true;
    });
  });
  if (houveEscrita) await batch.commit();

  // Atualiza cache local sem reler o Firestore
  atualizarCacheAposConsumo(consumos);

  return {
    consumos,
    incompleto,
    receitaNome: receita.name,
    receitaId: receita.id || null,
    multiplicador,
    ops: contexto.ops || [],
    codigo: contexto.codigo || null,
    produto: contexto.produto || null,
    operador: contexto.operador || null,
  };
}

// ── Genealogia: consolida TODAS as batidas de um item de produção ───
// Recebe o array `consumoMP` de um item de producaoDiaria (uma entrada por batida)
// e devolve, por insumo, os lotes que entraram e quanto de cada um.
//
// É este objeto que a Expedição grava dentro do lote de PA, fechando a corrente:
//   lote de farinha → batida → lote de PA → cliente
export function resumirOrigemMP(consumoMP) {
  if (!Array.isArray(consumoMP) || consumoMP.length === 0) return null;

  const porInsumo = {};   // productId → { nomeMP, unidade, lotes: { loteId → {...} } }
  const opsSet = new Set();
  let batidas = 0;
  let algumIncompleto = false;

  for (const batida of consumoMP) {
    batidas++;
    if (batida.incompleto) algumIncompleto = true;
    if (batida.numeroOP) opsSet.add(batida.numeroOP);
    (batida.ops || []).forEach(op => opsSet.add(op));

    for (const c of (batida.consumos || [])) {
      if (!porInsumo[c.productId]) {
        porInsumo[c.productId] = {
          productId: c.productId,
          nomeMP: c.nomeMP,
          unidade: c.unidade || 'kg',
          totalConsumido: 0,
          lotes: {},
        };
      }
      const alvo = porInsumo[c.productId];

      for (const l of (c.lotes || [])) {
        if (!alvo.lotes[l.loteId]) {
          alvo.lotes[l.loteId] = {
            loteId: l.loteId,
            loteNumero: l.loteNumero,
            validade: l.validade || null,
            quantidade: 0,
            forcadoManualmente: false,
          };
        }
        alvo.lotes[l.loteId].quantidade += l.quantidade || 0;
        // Se em QUALQUER batida esse lote foi escolha manual, marca como manual.
        if (l.forcadoManualmente) alvo.lotes[l.loteId].forcadoManualmente = true;
        alvo.totalConsumido += l.quantidade || 0;
      }
    }
  }

  return {
    batidas,
    incompleto: algumIncompleto,
    ops: Array.from(opsSet),
    // Achata para array — Firestore não gosta de chaves dinâmicas profundas
    insumos: Object.values(porInsumo).map(i => ({
      productId: i.productId,
      nomeMP: i.nomeMP,
      unidade: i.unidade,
      totalConsumido: Number(i.totalConsumido.toFixed(4)),
      lotes: Object.values(i.lotes).map(l => ({
        ...l,
        quantidade: Number(l.quantidade.toFixed(4)),
      })),
    })),
    consolidadoEm: new Date().toISOString(),
  };
}

// ── Reverte um consumo (usado quando o operador desfaz uma batida) ──
export async function reverterConsumoFEFO(consumoRegistrado) {
  if (!consumoRegistrado?.consumos?.length) return;
  const mUid = await obterMasterUid();
  const batch = writeBatch(dbEstoqueOS);
  let houveEscrita = false;
  consumoRegistrado.consumos.forEach(c => {
    (c.lotes || []).forEach(l => {
      batch.update(doc(dbEstoqueOS, 'users', mUid, 'batches', l.loteId), { quantity: increment(l.quantidade) });
      houveEscrita = true;
    });
  });
  if (houveEscrita) await batch.commit();

  // Atualiza cache local sem reler
  atualizarCacheAposReversao(consumoRegistrado);
}
