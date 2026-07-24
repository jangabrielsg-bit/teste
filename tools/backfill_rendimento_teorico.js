/**
 * Backfill: corrige rendimentoTeorico=0 nos dias já registrados
 * ================================================================
 *
 * O fix aplicado em bridge_winthor.js só vale pra sincronizações NOVAS
 * — os dias que já estavam em producaoDiaria/{data} continuam com
 * rendimentoTeorico: 0 pra sempre (foi assim que a bridge escreveu na
 * época). Esse script corrige isso uma vez, de forma retroativa.
 *
 * Limitação importante: não existe histórico do rendimento por receita
 * dia a dia — só o rendimento médio ATUAL de cada código (estoquePA).
 * Então o backfill usa o rendimento real de hoje como aproximação para
 * os dias antigos. Não é uma reconstrução perfeita do que era o
 * rendimento teórico naquele dia específico, é a melhor estimativa
 * disponível. Itens já corrigidos manualmente (pelo botão "Corrigir
 * rendimento" do PCP) NÃO são sobrescritos.
 *
 * Como rodar (na mesma máquina/pasta da bridge, que já tem
 * firebase-admin instalado e o serviceAccountKey.json):
 *
 *   node backfill_rendimento_teorico.js
 *
 * É seguro rodar mais de uma vez — só mexe em itens que ainda estão
 * com rendimentoTeorico zerado/ausente e não foram corrigidos na mão.
 * Depois de rodar, a próxima sincronização do script do Google Sheets
 * (a cada 5 min) já atualiza a planilha sozinha, sem nenhuma ação
 * manual na planilha.
 */
require('dotenv').config();
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
  console.log('🔄 Lendo rendimento real atual (coleção estoquePA)...');
  const estoqueSnap = await db.collection('estoquePA').get();
  const rendimentoPorCodigo = {};
  estoqueSnap.forEach(doc => {
    const d = doc.data();
    if (d.rendimentoReal > 0) rendimentoPorCodigo[doc.id] = d.rendimentoReal;
  });
  console.log(`   ${Object.keys(rendimentoPorCodigo).length} código(s) com rendimento real disponível.\n`);

  console.log('🔄 Lendo producaoDiaria (todos os dias)...');
  const producaoSnap = await db.collection('producaoDiaria').get();
  console.log(`   ${producaoSnap.size} dia(s) encontrado(s).\n`);

  let docsAtualizados = 0;
  let itensCorrigidos = 0;
  let semRendimentoDisponivel = 0;

  for (const doc of producaoSnap.docs) {
    const dados = doc.data();
    const itens = dados.itens || [];
    let mudou = false;

    const novosItens = itens.map(it => {
      const jaTemRendimento   = (it.rendimentoTeorico || 0) > 0;
      const corrigidoNaMao    = it.rendimentoCorrigidoManualmente === true;
      if (jaTemRendimento || corrigidoNaMao) return it;

      const rendimentoAtual = rendimentoPorCodigo[it.codigo];
      if (!rendimentoAtual) { semRendimentoDisponivel++; return it; }

      mudou = true;
      itensCorrigidos++;
      return {
        ...it,
        rendimentoTeorico: rendimentoAtual,
        rendimentoTeoricoBackfill: true,        // marca que veio do backfill, não da bridge na época
        rendimentoTeoricoBackfillEm: new Date().toISOString(),
      };
    });

    if (mudou) {
      await doc.ref.update({ itens: novosItens });
      docsAtualizados++;
      console.log(`   ✅ ${doc.id}: corrigido`);
    }
  }

  console.log(`\n✅ Concluído.`);
  console.log(`   ${docsAtualizados} dia(s) atualizado(s).`);
  console.log(`   ${itensCorrigidos} item(ns) corrigido(s).`);
  if (semRendimentoDisponivel > 0) {
    console.log(`   ⚠️  ${semRendimentoDisponivel} item(ns) continuam zerados — código não tem rendimento real ainda em estoquePA (produto sem histórico/nunca sincronizado).`);
  }
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Erro no backfill:', e.message);
  process.exit(1);
});
