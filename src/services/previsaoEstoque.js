// ── Previsão de estoque de Produto Acabado (PA) e conferência do dia seguinte ──
//
// Ideia: se hoje o Winthor mostra 80 kg em estoque e a saída das últimas 24h
// foi 30 kg, a expectativa ingênua é fechar amanhã com ~50 kg (sem contar
// produção nova, que já entra separadamente pela Câmara). Guardamos essa
// previsão hoje; amanhã, quando o valor real chegar do Winthor, comparamos.
//
// Divergência não decide sozinha o que aconteceu — só aponta o dedo pra onde
// olhar (perda não registrada, contagem errada, saída não lançada, produção
// que não foi somada). Por isso a UI deixa o PCP registrar uma justificativa,
// em vez de tentar "corrigir" o número sozinho.
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from './firebase';
import { agoraServidor } from './relogioServidor';
import { paraISO, somarDiasISO } from './utils';

const COLECAO = 'previsaoEstoquePA';
const TOLERANCIA_PERCENTUAL = 0.10; // até 10% de diferença é considerado "bateu"
const TOLERANCIA_MINIMA = 2;        // e diferenças pequenas (ruído de contagem) também

// ── Gera, no máximo 1x por dia, a previsão de amanhã com base no estoque
// e na saída das últimas 24h de hoje. Idempotente: se já gerou hoje, sai.
export async function gerarPrevisaoParaAmanha(winthorPAMap) {
  const hoje = paraISO(agoraServidor());
  const controleRef = doc(db, COLECAO, '_controle');
  const controleSnap = await getDoc(controleRef);
  if (controleSnap.exists() && controleSnap.data().ultimaGeracao === hoje) return;

  const itens = Object.entries(winthorPAMap || {})
    .filter(([, w]) => w && w.estoqueAtual != null)
    .map(([codigo, w]) => ({
      codigo,
      produto: w.produto || codigo,
      unidade: w.unidade || 'UN',
      estoqueBase: w.estoqueAtual,
      saidaBase: w.saida24h || 0,
      previsto: Math.max(0, w.estoqueAtual - (w.saida24h || 0)),
    }));

  if (itens.length === 0) return;

  const amanha = somarDiasISO(hoje, 1);
  await setDoc(doc(db, COLECAO, amanha), {
    dataBase: hoje,
    itens,
    geradoEm: agoraServidor().toISOString(),
  }, { merge: true });

  await setDoc(controleRef, { ultimaGeracao: hoje }, { merge: true });
}

// ── Hook: previsão feita ONTEM para o estoque de HOJE, por código ──
export function usePrevisaoHoje() {
  const [previsao, setPrevisao] = useState({}); // codigo → { previsto, estoqueBase, saidaBase, dataBase, justificativa }
  useEffect(() => {
    const hoje = paraISO(agoraServidor());
    const unsub = onSnapshot(doc(db, COLECAO, hoje), snap => {
      if (!snap.exists()) { setPrevisao({}); return; }
      const dados = snap.data();
      const mapa = {};
      (dados.itens || []).forEach(it => {
        mapa[it.codigo] = { ...it, justificativa: (dados.justificativas || {})[it.codigo] || null };
      });
      setPrevisao(mapa);
    });
    return unsub;
  }, []);
  return previsao;
}

// ── Calcula se real x previsto divergem além da tolerância ──
export function avaliarDivergencia(previsto, real) {
  if (previsto == null || real == null) return null;
  const delta = real - previsto;
  const percentual = previsto > 0 ? Math.abs(delta) / previsto : (Math.abs(delta) > 0 ? 1 : 0);
  const divergente = Math.abs(delta) > TOLERANCIA_MINIMA && percentual > TOLERANCIA_PERCENTUAL;
  return { delta, percentual, divergente };
}

// ── Registra a justificativa de um PCP para a divergência de um item ──
export async function justificarDivergencia(codigo, texto, autor) {
  const hoje = paraISO(agoraServidor());
  await setDoc(doc(db, COLECAO, hoje), {
    justificativas: {
      [codigo]: { texto, por: autor || 'Não identificado', em: agoraServidor().toISOString() },
    },
  }, { merge: true });
}
