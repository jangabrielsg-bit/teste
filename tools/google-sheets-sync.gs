/**
 * Sincronização Firestore → Google Sheets (Produção e Paradas)
 * ==============================================================
 *
 * Como instalar:
 *   1. Abra a planilha de destino no navegador.
 *   2. Menu Extensões → Apps Script.
 *   3. Apague o conteúdo padrão de Code.gs e cole este arquivo inteiro.
 *   4. Salve (ícone de disquete).
 *   5. No topo, selecione a função "configurarSincronizacaoAutomatica" e
 *      clique em "Executar". Na primeira vez o Google vai pedir autorização
 *      (é o seu próprio script pedindo permissão pra editar a própria
 *      planilha e fazer chamadas HTTP — pode autorizar).
 *   6. Pronto. A partir daí ele sincroniza sozinho a cada 5 minutos.
 *      Pra forçar uma sincronização na hora, rode a função "sincronizar".
 *
 * O que ele faz:
 *   - Lê, para cada um dos últimos DIAS_JANELA dias, o documento
 *     producaoDiaria/{data} (itens, paradas) e expedicaoDiaria/{data}
 *     (patinhas confirmadas na câmara) do Firestore do app.
 *   - Aba "Produção": 1 linha por produto/dia, comparando programado x
 *     realizado e rendimento teórico x real (peso que chegou na câmara).
 *   - Aba "Paradas": 1 linha por parada de linha registrada.
 *   - Não duplica: cada linha tem uma chave (coluna A) usada para
 *     atualizar em vez de duplicar quando os dados mudam.
 *
 * Não precisa de plano pago (Blaze) nem de conta de serviço — usa a
 * mesma autenticação anônima que o próprio app já usa, e por isso só
 * enxerga o que as regras do Firestore liberam para um usuário
 * autenticado (não expõe nada que o app não já exponha).
 */

// ── Configuração ────────────────────────────────────────────────────
var API_KEY = 'AIzaSyBYriLi3N0Z4ktETeBep8SweiN2rVHRAvs'; // Web API Key do Firebase — pública por design (services/firebase.js do app)
var PROJECT_ID = 'rastreio-producao';
var FUSO_HORARIO = 'America/Sao_Paulo';
var DIAS_JANELA = 21;   // quantos dias pra trás re-sincronizar a cada execução
var ABA_PRODUCAO = 'Produção';
var ABA_PARADAS = 'Paradas';

var CABECALHO_PRODUCAO = [
  'Chave', 'Data', 'DataBR', 'Codigo', 'Produto', 'Categoria', 'OPs',
  'Programado', 'Realizado', 'PercentualAtingido', 'Status',
  'MotivoFinalizacaoAntecipada', 'DeficitFinalizacao',
  'RendimentoTeoricoUnitKg', 'RendimentoTeoricoTotalKg', 'PesoRealCamaraKg',
  'DivergenciaPercentual',
  'MassaPerdidaProducaoKg', 'MotivoPerdaProducao',
  'MassaPerdidaEmbalagemKg', 'MotivoPerdaEmbalagem',
  'PeDeMassaKg', 'PrimeiraBatida', 'UltimaBatida', 'QtdBatidas',
  'FechamentoConfirmado', 'AtualizadoEm',
];

var CABECALHO_PARADAS = [
  'Chave', 'Data', 'DataBR', 'Codigo', 'Motivo', 'Inicio', 'Fim',
  'DuracaoMin', 'RegistradoPor', 'Status', 'AtualizadoEm',
];

// ── Ponto de entrada: instala o gatilho automático e roda uma vez ────
function configurarSincronizacaoAutomatica() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(5).create();
  sincronizar();
}

// ── Sincronização principal — pode rodar manualmente a qualquer hora ──
function sincronizar() {
  var idToken = obterIdToken();
  var hoje = new Date();
  var linhasProducao = [];
  var linhasParadas = [];

  for (var i = 0; i < DIAS_JANELA; i++) {
    var d = new Date(hoje);
    d.setDate(d.getDate() - i);
    var dataISO = Utilities.formatDate(d, FUSO_HORARIO, 'yyyy-MM-dd');
    var dataBR = Utilities.formatDate(d, FUSO_HORARIO, 'dd/MM/yyyy');

    var producaoDia = buscarDocumento(idToken, 'producaoDiaria', dataISO);
    var expedicaoDia = buscarDocumento(idToken, 'expedicaoDiaria', dataISO);
    if (!producaoDia) continue;

    var pesoRealPorCodigo = {};
    if (expedicaoDia && expedicaoDia.registros) {
      expedicaoDia.registros.forEach(function (r) {
        var cod = r.codigoProduto || '';
        pesoRealPorCodigo[cod] = (pesoRealPorCodigo[cod] || 0) + (Number(r.pesoTotal) || 0);
      });
    }

    (producaoDia.itens || []).forEach(function (it) {
      var teoricoUnit = Number(it.rendimentoTeorico) || 0;
      var feitos = Number(it.feitos) || 0;
      var meta = Number(it.metaLotes) || 0;
      var bruto = teoricoUnit * feitos;
      var perdas = (Number(it.massaPerdidaProd) || 0) + (Number(it.massaPerdidaEmb) || 0);
      var pe = Number(it.peDeMassa) || 0;
      var teoricoTotal = bruto - perdas + pe;
      var real = pesoRealPorCodigo[it.codigo] || 0;
      var divergenciaPct = teoricoTotal > 0 ? ((real - teoricoTotal) / teoricoTotal) * 100 : '';
      var batidas = it.batidas || [];
      var status = it.finalizadoAntecipadamente
        ? 'Finalizado abaixo da meta'
        : (feitos >= meta && meta > 0 ? 'Concluído' : 'Em andamento');

      linhasProducao.push([
        dataISO + '__' + (it.codigo || it.produto),
        dataISO, dataBR,
        it.codigo || '', it.produto || '', it.categoria || '',
        (it.ops || []).join(', '),
        meta, feitos,
        meta > 0 ? Math.round((feitos / meta) * 100) : '',
        status,
        it.motivoFinalizacaoAntecipada || '',
        it.deficit != null ? it.deficit : '',
        teoricoUnit, arredondar(teoricoTotal), arredondar(real),
        divergenciaPct !== '' ? arredondar(divergenciaPct) : '',
        Number(it.massaPerdidaProd) || 0, it.massaPerdidaProdMotivo || '',
        Number(it.massaPerdidaEmb) || 0, it.massaPerdidaEmbMotivo || '',
        pe,
        batidas[0] || '', batidas[batidas.length - 1] || '', batidas.length,
        !!it.finalizado,
        new Date().toISOString(),
      ]);
    });

    (producaoDia.paradas || []).forEach(function (p) {
      var duracao = p.duracaoMin != null
        ? p.duracaoMin
        : (p.fim ? Math.round((new Date(p.fim) - new Date(p.inicio)) / 60000) : '');
      linhasParadas.push([
        dataISO + '__' + p.codigo + '__' + p.inicio,
        dataISO, dataBR,
        p.codigo || '', p.label || '',
        p.inicio || '', p.fim || '',
        duracao,
        p.registradoPor || '',
        p.fim ? 'Encerrada' : 'Aberta',
        new Date().toISOString(),
      ]);
    });
  }

  upsertLinhas(ABA_PRODUCAO, CABECALHO_PRODUCAO, linhasProducao);
  upsertLinhas(ABA_PARADAS, CABECALHO_PARADAS, linhasParadas);
}

function arredondar(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ── Grava/atualiza linhas numa aba, usando a coluna A (Chave) pra não duplicar ──
function upsertLinhas(nomeAba, cabecalho, linhas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(nomeAba) || ss.insertSheet(nomeAba);

  if (aba.getLastRow() === 0) {
    aba.appendRow(cabecalho);
    aba.setFrozenRows(1);
  }

  var dadosAtuais = aba.getDataRange().getValues();
  var indicePorChave = {};
  for (var r = 1; r < dadosAtuais.length; r++) {
    indicePorChave[dadosAtuais[r][0]] = r + 1; // linha real na planilha (1-indexed)
  }

  var novasLinhas = [];
  linhas.forEach(function (linha) {
    var linhaExistente = indicePorChave[linha[0]];
    if (linhaExistente) {
      aba.getRange(linhaExistente, 1, 1, linha.length).setValues([linha]);
    } else {
      novasLinhas.push(linha);
    }
  });

  if (novasLinhas.length > 0) {
    aba.getRange(aba.getLastRow() + 1, 1, novasLinhas.length, cabecalho.length).setValues(novasLinhas);
  }
}

// ── Autenticação anônima no Firebase (mesmo mecanismo do app) ────────
// Guarda o refresh token nas Propriedades do Script pra não criar um
// usuário anônimo novo a cada execução — só renova o token de acesso.
function obterIdToken() {
  var props = PropertiesService.getScriptProperties();
  var refreshToken = props.getProperty('FIREBASE_REFRESH_TOKEN');

  if (refreshToken) {
    var resp = UrlFetchApp.fetch('https://securetoken.googleapis.com/v1/token?key=' + API_KEY, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: { grant_type: 'refresh_token', refresh_token: refreshToken },
      muteHttpExceptions: true,
    });
    var dados = JSON.parse(resp.getContentText());
    if (dados.id_token) {
      if (dados.refresh_token) props.setProperty('FIREBASE_REFRESH_TOKEN', dados.refresh_token);
      return dados.id_token;
    }
  }

  var signup = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + API_KEY, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ returnSecureToken: true }),
    muteHttpExceptions: true,
  });
  var novo = JSON.parse(signup.getContentText());
  if (!novo.idToken) throw new Error('Falha ao autenticar no Firebase: ' + signup.getContentText());
  props.setProperty('FIREBASE_REFRESH_TOKEN', novo.refreshToken);
  return novo.idToken;
}

// ── Busca um documento do Firestore via REST, já convertido pra objeto simples ──
function buscarDocumento(idToken, colecao, docId) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
    '/databases/(default)/documents/' + colecao + '/' + docId;
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + idToken },
    muteHttpExceptions: true,
  });
  var codigo = resp.getResponseCode();
  if (codigo === 404) return null;
  if (codigo !== 200) throw new Error('Erro Firestore ' + colecao + '/' + docId + ' (' + codigo + '): ' + resp.getContentText());
  var json = JSON.parse(resp.getContentText());
  return parseFirestoreFields(json.fields || {});
}

// ── Conversores do formato tipado do Firestore REST pra objeto JS simples ──
function parseFirestoreFields(fields) {
  var obj = {};
  for (var chave in fields) obj[chave] = parseFirestoreValue(fields[chave]);
  return obj;
}

function parseFirestoreValue(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(parseFirestoreValue);
  if (v.mapValue !== undefined) return parseFirestoreFields(v.mapValue.fields || {});
  return null;
}
