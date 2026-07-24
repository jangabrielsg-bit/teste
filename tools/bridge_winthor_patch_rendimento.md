# Patch: rendimento teórico sempre zerado na bridge

## Causa raiz

Em `obterOPs()` (bridge_winthor.js), todas as colunas usam um índice de
segurança (`Math.max(N, idx(...))`) caso o texto do cabeçalho não seja
reconhecido — **exceto `posRend`**:

```js
const posRend = idx(/rendimento|rend\b|rend\.|peso.*prev|kg.*prev|qtd.*kg|qtde.*kg|prev.*kg/);
```

Se o cabeçalho real da tabela "Ordens de Produção" do portal Winthor não
bater com esse regex, `idx()` devolve `-1`, e a linha abaixo cai sempre no
`: 0` — rendimento zerado para toda ordem, sem nenhum aviso no console:

```js
RENDIMENTO_TOTAL: posRend>=0 ? num(c[posRend]) * (num(c[posReceitas])||1) : 0,
```

## Correção

Substituir o trecho de `obterOPs()` por este (adiciona aviso de diagnóstico
e não deixa a função sem saber quais cabeçalhos existem):

```js
async function obterOPs(jar) {
  const page = await req(URLS.ordens,'GET',null,null,jar);
  if (/type="password"/i.test(page.body)) throw new Error('Sessão expirou ao acessar OPs.');
  const { headers, rows } = parseTabela(page.body);

  const idx = h => headers.findIndex(x => h.test(norm(x)));
  const posData     = Math.max(0, idx(/previs|data|inicio/));
  const posCat      = Math.max(1, idx(/setor|categ|grupo|familia|classe/));
  const posCodigo   = Math.max(2, idx(/codigo/));
  const posProduto  = Math.max(3, idx(/produto/));
  const posNumOrdem = Math.max(4, idx(/ordem|op\b/));
  const posReceitas = Math.max(5, idx(/receita/));
  const posRend     = idx(/rendimento|rend\b|rend\.|peso.*prev|kg.*prev|qtd.*kg|qtde.*kg|prev.*kg/);

  if (posRend < 0) {
    console.warn('⚠️  Coluna de RENDIMENTO não encontrada na tabela de Ordens — RENDIMENTO_TOTAL vai ficar 0 para todas as OPs.');
    console.warn('    Cabeçalhos encontrados na tabela:', JSON.stringify(headers));
  } else {
    console.log(`   Coluna de rendimento: "${headers[posRend]}" (índice ${posRend})`);
  }

  return rows
    .filter(c => c.length>=4 && c[posData])
    .map(c => ({
      DATA_PROD: c[posData], NUM_OP: c[posNumOrdem], CODIGO: c[posCodigo],
      PRODUTO: c[posProduto], RECEITAS: c[posReceitas]||'1',
      RENDIMENTO_TOTAL: posRend>=0 ? num(c[posRend]) * (num(c[posReceitas])||1) : 0,
      CATEGORIA: c[posCat]||'Sem setor',
    }));
}
```

## Próximo passo

1. Aplique esse patch no `bridge_winthor.js` (na máquina onde ele roda).
2. Rode a bridge uma vez (ou peça sincronização manual pelo botão do WMS).
3. Olhe o console: vai aparecer **exatamente** os cabeçalhos reais da
   tabela de Ordens (ex.: `["Data Prev.","Setor","Código","Produto","OP","Receitas","Rend. Kg"]`).
4. Me manda esse console.log — a partir do nome exato eu ajusto o regex
   de `posRend` pra casar com a coluna certa (ou já dá pra saber na hora,
   se o nome for óbvio).

Isso conserta o rendimento teórico na origem (Winthor → Firestore →
`producaoDiaria.itens[].rendimentoTeorico`), então tanto o app quanto a
planilha do Google Sheets passam a receber o valor real automaticamente
— nenhuma mudança adicional necessária no app nem no script de
sincronização com o Sheets.
