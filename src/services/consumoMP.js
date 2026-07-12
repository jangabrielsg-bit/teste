import { collection, getDocs, query, where, doc, writeBatch, increment, updateDoc } from 'firebase/firestore';
import { db, dbEstoqueOS } from './firebase';

// ── Normalização de texto (compara nomes ignorando acentos/caixa) ──
function normalizar(txt) {
  return (txt || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// ── Cache em memória — evita reler `recipes` e `inventory` a cada +1 ──
let cacheReceitas = null;
let cacheReceitasEm = 0;
let cacheInventory = null;
let cacheInventoryEm = 0;
const TTL_CACHE_MS = 10 * 60 * 1000; // 10 minutos

async function carregarReceitas() {
  const agora = Date.now();
  if (cacheReceitas && (agora - cacheReceitasEm) < TTL_CACHE_MS) return cacheReceitas;
  const snap = await getDocs(collection(dbEstoqueOS, 'recipes'));
  const lista = [];
  snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
  cacheReceitas = lista;
  cacheReceitasEm = agora;
  return lista;
}

async function carregarInventoryMap() {
  const agora = Date.now();
  if (cacheInventory && (agora - cacheInventoryEm) < TTL_CACHE_MS) return cacheInventory;
  const snap = await getDocs(collection(dbEstoqueOS, 'inventory'));
  const mapa = {};
  snap.forEach(d => { mapa[d.id] = { id: d.id, ...d.data() }; });
  cacheInventory = mapa;
  cacheInventoryEm = agora;
  return mapa;
}

// Força recarregar na próxima chamada (útil após edições manuais de ficha técnica)
export function invalidarCacheReceitas() { cacheReceitas = null; cacheInventory = null; }

// Acesso público ao mapa de insumos (usado pela UI de troca de lote)
export async function obterInventoryMap() {
  return carregarInventoryMap();
}

// ── Identifica ingredientes de farinha numa receita (único insumo que ──
// ── o operador pode trocar manualmente durante a produção)          ──
export async function identificarIngredientesFarinha(receita) {
  if (!receita?.ingredients?.length) return [];
  const inventoryMap = await carregarInventoryMap();
  return receita.ingredients
    .map(ing => ({ productId: ing.productId, nome: (inventoryMap[ing.productId]?.name || '') }))
    .filter(ing => normalizar(ing.nome).includes('farinha'));
}

// ── Lista os lotes disponíveis de um insumo, em ordem FEFO ──────────
// (usado pelo modal de troca manual de lote de farinha)
export async function listarLotesDisponiveis(productId) {
  const snap = await getDocs(query(collection(dbEstoqueOS, 'batches'), where('productId', '==', productId)));
  const lotes = [];
  snap.forEach(d => {
    const dados = d.data();
    if ((dados.quantity || 0) > 0) lotes.push({ id: d.id, ...dados });
  });
  lotes.sort((a, b) => {
    const va = a.expiryDate || a.validade || '9999-12-31';
    const vb = b.expiryDate || b.validade || '9999-12-31';
    return va.localeCompare(vb);
  });
  return lotes;
}

// ── Define manualmente qual lote de um insumo deve ser usado agora ──
// Fica salvo no próprio documento do dia (producaoDiaria), com timestamp
// da troca — vale para qualquer receita que use esse mesmo insumo no dia.
export async function definirLoteForcado(dataISO, productId, lote, operador) {
  const campo = `lotesForcados.${productId}`;
  await updateDoc(doc(db, 'producaoDiaria', dataISO), {
    [campo]: {
      loteId: lote.id,
      loteNumero: lote.batchNumber || lote.code || lote.number || lote.id,
      validade: lote.expiryDate || lote.validade || null,
      selecionadoEm: new Date().toISOString(),
      selecionadoPor: operador || null,
    },
  });
}

// ── Encontra a ficha técnica de um produto pelo nome ────────────────
export async function buscarReceitaPorNomeProduto(nomeProduto) {
  const receitas = await carregarReceitas();
  const alvo = normalizar(nomeProduto);
  return receitas.find(r => normalizar(r.name) === alvo) || null;
}

// ── Consome os ingredientes de uma receita via FEFO ─────────────────
// multiplicador = quantas "receitas/lotes" essa batida representa (normalmente 1)
// lotesForcados = { [productId]: { loteId, ... } } — override manual (ex: farinha)
//   O lote forçado entra primeiro na fila; se acabar no meio da batelada,
//   o sistema segue automaticamente para o próximo lote em ordem FEFO.
// Retorna { consumos: [...], incompleto: bool } para registrar rastreabilidade
export async function consumirIngredientesFEFO(receita, multiplicador = 1, lotesForcados = {}) {
  const inventoryMap = await carregarInventoryMap();
  const consumos = [];
  let incompleto = false;

  for (const ingrediente of (receita.ingredients || [])) {
    const necessario = (ingrediente.quantity || 0) * multiplicador;
    if (necessario <= 0) continue;

    const infoMP = inventoryMap[ingrediente.productId] || { name: 'Insumo desconhecido', unit: 'kg' };

    // Busca todos os lotes desse insumo (filtra quantidade/validade em memória —
    // evita exigir índice composto no Firestore)
    const snapLotes = await getDocs(
      query(collection(dbEstoqueOS, 'batches'), where('productId', '==', ingrediente.productId))
    );
    const lotes = [];
    snapLotes.forEach(d => {
      const dados = d.data();
      if ((dados.quantity || 0) > 0) lotes.push({ id: d.id, ...dados });
    });

    // FEFO: ordena por validade crescente (lotes sem validade vão para o final da fila)
    lotes.sort((a, b) => {
      const va = a.expiryDate || a.validade || '9999-12-31';
      const vb = b.expiryDate || b.validade || '9999-12-31';
      return va.localeCompare(vb);
    });

    // Se há um lote forçado manualmente para esse insumo (ex: farinha em uso),
    // ele fura a fila e vai para o topo — o resto segue em ordem FEFO normal.
    const forcado = lotesForcados?.[ingrediente.productId];
    let filaConsumo = lotes;
    if (forcado?.loteId) {
      const idxForcado = lotes.findIndex(l => l.id === forcado.loteId);
      if (idxForcado > 0) {
        const [loteForcado] = lotes.splice(idxForcado, 1);
        filaConsumo = [loteForcado, ...lotes];
      }
      // Se idxForcado === 0, já está na frente (ou -1: lote esgotado/sumiu → segue FEFO puro)
    }

    let restante = necessario;
    const consumidosDesteIngrediente = [];

    for (const lote of filaConsumo) {
      if (restante <= 0) break;
      const disponivel = lote.quantity || 0;
      const retirar = Math.min(disponivel, restante);
      if (retirar <= 0) continue;
      consumidosDesteIngrediente.push({
        loteId: lote.id,
        loteNumero: lote.batchNumber || lote.code || lote.number || lote.id,
        validade: lote.expiryDate || lote.validade || null,
        quantidade: retirar,
        forcadoManualmente: !!(forcado?.loteId === lote.id),
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
      faltou: restante,
      lotes: consumidosDesteIngrediente,
    });
  }

  // Grava os descontos em batch — increment() é seguro para concorrência
  const lote = writeBatch(dbEstoqueOS);
  let houveEscrita = false;
  consumos.forEach(c => {
    c.lotes.forEach(l => {
      lote.update(doc(dbEstoqueOS, 'batches', l.loteId), { quantity: increment(-l.quantidade) });
      houveEscrita = true;
    });
  });
  if (houveEscrita) await lote.commit();

  return { consumos, incompleto, receitaNome: receita.name };
}

// ── Reverte um consumo (usado quando o operador desfaz uma batida) ──
export async function reverterConsumoFEFO(consumoRegistrado) {
  if (!consumoRegistrado?.consumos?.length) return;
  const lote = writeBatch(dbEstoqueOS);
  let houveEscrita = false;
  consumoRegistrado.consumos.forEach(c => {
    c.lotes.forEach(l => {
      lote.update(doc(dbEstoqueOS, 'batches', l.loteId), { quantity: increment(l.quantidade) });
      houveEscrita = true;
    });
  });
  if (houveEscrita) await lote.commit();
}
