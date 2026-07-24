require('dotenv').config();

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const admin = require('firebase-admin');

// ── FIREBASE ──────────────────────────────────────────────────────
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── CONFIGURAÇÕES ─────────────────────────────────────────────────
const PORTAL_BASE     = process.env.PORTAL_BASE     || 'http://192.168.26.200:8080';
const P_USUARIO       = process.env.PORTAL_USUARIO;
const P_SENHA         = process.env.PORTAL_SENHA;
const HTTP_TIMEOUT    = parseInt(process.env.HTTP_TIMEOUT_MS, 10) || 15000;
const DIAS_MEDIA      = parseInt(process.env.DIAS_MEDIA,      10) || 30;
const HORAS_ALERTA    = parseInt(process.env.HORAS_ALERTA,    10) || 48;
const SETORES_RAW     = (process.env.SETORES_PERMITIDOS || 'Pães Congelados').split(',').map(s => s.trim()).filter(Boolean);
const DIAS_MEDIA_MOVI = parseInt(process.env.DIAS_MEDIA_MOVI, 10) || 30;

const URLS = {
  login:    PORTAL_BASE + '/imac/index',
  ordens:   PORTAL_BASE + '/imac/pages/producao/listaOrdens',
  estoquePA:PORTAL_BASE + '/imac/pages/movi/movEstoqueProd',
  saidas:   PORTAL_BASE + '/imac/pages/movi/movInicial',
  saidasInt:PORTAL_BASE + '/imac/pages/movi/movInicialInterior',
  mediaMovi:PORTAL_BASE + '/imac/pages/movi/consultarMediaMovi2',
};

const CATEGORIAS_MEDIA = [
  { nome: 'Pães',           valor: '667' },
  { nome: 'Pães Especiais', valor: '891' },
  { nome: 'Pré Assados',    valor: '669' },
  { nome: 'Pães de Queijo', valor: '668' },
  { nome: 'Salgados',       valor: '794' },
  { nome: 'Confeitaria',    valor: '920' },
];

if (!P_USUARIO || !P_SENHA) {
  console.error('❌ Configure PORTAL_USUARIO e PORTAL_SENHA no .env.');
  process.exit(1);
}

// ── UTILITÁRIOS ────────────────────────────────────────────────────
function norm(t) { return (t||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
const SETORES = SETORES_RAW.map(norm);
function setorOk(cat) { return SETORES.includes(norm(cat)); }
function num(v) {
  if (v == null) return 0;
  let s = String(v).trim();
  if (s === '') return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g,'').replace(',','.');
  else if (s.includes(',')) s = s.replace(',','.');
  else if ((s.match(/\./g)||[]).length > 1) s = s.replace(/\./g,'');
  s = s.replace(/[^\d.-]/g,'');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
function paraISO(txt) {
  const p = (txt||'').trim().split('/');
  if (p.length === 3) { let [d,m,y]=p; if(y.length===2) y='20'+y; return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  if (p.length === 2) { const [d,m]=p; const h=new Date(); let a=h.getFullYear(); if(parseInt(m)<h.getMonth()-4) a++; return `${a}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
  return null;
}
function hoje() { return new Date().toISOString().slice(0,10); }
function diasAtras(n) { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }
function fmtBR(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }

// ── HTTP ──────────────────────────────────────────────────────────
function httpReq(rawUrl, method, headers, bodyStr, jar) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(rawUrl);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const cookieStr = Object.keys(jar).map(k => k+'='+jar[k]).join('; ');
    const allHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
      'Cookie': cookieStr, 'Connection': 'keep-alive',
    };
    if (headers) Object.assign(allHeaders, headers);
    let bodyBuf = null;
    if (bodyStr) {
      bodyBuf = Buffer.from(bodyStr, 'utf8');
      allHeaders['Content-Type']   = 'application/x-www-form-urlencoded';
      allHeaders['Content-Length'] = bodyBuf.length;
    }
    const r = lib.request({
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : (parsed.protocol==='https:'?443:80),
      path: parsed.pathname + (parsed.search||''),
      method: method||'GET', headers: allHeaders,
    }, res => {
      const raw = res.headers['set-cookie'];
      if (raw) (Array.isArray(raw)?raw:[raw]).forEach(c => {
        const pair = c.split(';')[0]; const eq = pair.indexOf('=');
        if (eq>0) jar[pair.slice(0,eq).trim()] = pair.slice(eq+1).trim();
      });
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode||0, headers: res.headers||{}, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.setTimeout(HTTP_TIMEOUT, () => r.destroy(new Error(`Timeout ${rawUrl}`)));
    if (bodyBuf) r.write(bodyBuf);
    r.end();
  });
}
async function req(url, method, headers, body, jar) {
  let u=url, m=method||'GET', b=body||null, h=headers;
  for (let i=0; i<5; i++) {
    const r = await httpReq(u,m,h,b,jar);
    if (r.status>=300 && r.status<400 && r.headers.location) {
      u = r.headers.location.startsWith('http') ? r.headers.location : new URL(u).origin + r.headers.location;
      m='GET'; b=null; h=null; continue;
    }
    return r;
  }
  throw new Error('Muitos redirects');
}

// ── PARSER DE TABELA HTML ─────────────────────────────────────────
function parseTabela(html) {
  const headers = [];
  const theadM = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  if (theadM) { const re=/<th[^>]*>([\s\S]*?)<\/th>/gi; let m; while((m=re.exec(theadM[1]))!==null) headers.push(m[1].replace(/<[^>]+>/g,'').trim()); }
  const rows = [];
  const tbodyM = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (tbodyM) {
    const trRe=/<tr[^>]*>([\s\S]*?)<\/tr>/gi; let trM;
    while((trM=trRe.exec(tbodyM[1]))!==null) {
      const cells=[]; const tdRe=/<td[^>]*>([\s\S]*?)<\/td>/gi; let tdM;
      while((tdM=tdRe.exec(trM[1]))!==null) cells.push(tdM[1].replace(/<[^>]+>/g,'').trim());
      if (cells.length>0) rows.push(cells);
    }
  }
  return { headers, rows };
}

// ── STATUS NO FIRESTORE ───────────────────────────────────────────
async function setStatus(msg, progresso=null) {
  const d = { mensagem: msg, atualizadoEm: new Date().toISOString() };
  if (progresso !== null) d.progresso = progresso;
  await db.collection('bridge').doc('status').set(d, { merge: true });
  console.log(`   ${msg}`);
}

// ── LOGIN ─────────────────────────────────────────────────────────
async function fazerLogin() {
  const jar  = {};
  const page = await req(URLS.login, 'GET', null, null, jar);
  const viewState = (page.body.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/i)||[])[1];
  if (!viewState) throw new Error('ViewState não encontrado na página de login.');

  const userField = (page.body.match(/name="([^"]*j_idt\d+:[^"]*)"[^>]*placeholder="[Uu]su/)||[])[1] || 'j_idt14:j_idt17';
  const passField = (page.body.match(/name="([^"]*j_idt\d+:[^"]*)"[^>]*type="password"/)||[])[1]    || 'j_idt14:j_idt19';

  const postObj = {
    'javax.faces.partial.ajax':'true','javax.faces.source':'j_idt14:buttonIndex',
    'javax.faces.partial.execute':'j_idt14','javax.faces.partial.render':'j_idt14',
    'javax.faces.behavior.event':'action','javax.faces.partial.event':'click',
    'j_idt14':'j_idt14','javax.faces.ViewState':viewState,
  };
  postObj[userField] = P_USUARIO;
  postObj[passField] = P_SENHA;
  const body = Object.keys(postObj).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(postObj[k])).join('&');

  const resp = await httpReq(URLS.login,'POST',{'X-Requested-With':'XMLHttpRequest','Faces-Request':'partial/ajax'},body,jar);
  const redir = resp.body.match(/<redirect[^>]+url="([^"]+)"/i);
  if (redir) { const u=redir[1].startsWith('http')?redir[1]:PORTAL_BASE+redir[1]; await req(u,'GET',null,null,jar); }
  return jar;
}

// ── ORDENS DE PRODUÇÃO ────────────────────────────────────────────
// ✅ CORRIGIDO: posRend não tinha índice de segurança (Math.max(N, ...))
// como as outras colunas — se o regex não batesse com o cabeçalho real
// do portal, ficava em -1 e o rendimento saía sempre 0, silenciosamente,
// pra toda ordem. Agora loga um aviso com os cabeçalhos reais da tabela
// (e a coluna escolhida) toda vez que a bridge roda, pra nunca mais
// passar despercebido.
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
    console.warn('⚠️  Coluna de RENDIMENTO não encontrada na tabela de Ordens — RENDIMENTO_TOTAL vai ficar 0 para todas as OPs desta sincronização.');
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

// ── ESTOQUE PA ────────────────────────────────────────────────────
async function obterEstoquePA(jar) {
  const page = await req(URLS.estoquePA,'GET',null,null,jar);
  if (/type="password"/i.test(page.body)) throw new Error('Sessão expirou ao acessar estoque PA.');
  const html = page.body;
  const itens = [];
  const titleRe   = /<span[^>]*class="[^"]*ui-panel-title[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  const contentRe = /<div[^>]*class="[^"]*ui-panel-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  const titulos=[], conteudos=[];
  let m;
  while((m=titleRe.exec(html))!==null) { const t=m[1].replace(/<[^>]+>/g,'').trim().match(/\[\s*(\d+)\s*\]\s*-\s*(.+)/); if(t) titulos.push({pos:m.index,codigo:t[1].trim(),produto:t[2].trim()}); }
  while((m=contentRe.exec(html))!==null) conteudos.push({pos:m.index,html:m[1]});

  for (const titulo of titulos) {
    const c = conteudos.find(x=>x.pos>titulo.pos); if(!c) continue;
    const extrair = re => { for(const tr of c.html.split(/<\/tr>/i)) { if(re.test(tr)) { const s=tr.match(/<span[^>]*>([^<]+)<\/span>/i); if(s) return s[1].trim(); } } return null; };
    const parseQtd  = s => { if(!s) return {v:0,u:'UN'}; const p=s.trim().split(/\s+/); return {v:num(p[0]),u:(p[1]||'UN').toUpperCase()}; };
    const parseSaida = s => { if(!s) return {q:0,p:0}; const p=s.split('|'); return {q:num(p[0]),p:num(p[1]||'0')}; };
    const {v:estoqueAtual,u:unidade} = parseQtd(extrair(/QT\s*EM\s*ESTOQUE/i));
    const s24 = parseSaida(extrair(/SAIDA\s*24H/i));
    const s48 = parseSaida(extrair(/SAIDA\s*48H/i));
    itens.push({ codigo:titulo.codigo, produto:titulo.produto, estoqueAtual, unidade, estoqueMinimo:0,
      saida24h:s24.q, saida24hPedidos:s24.p, saida48h:s48.q, saida48hPedidos:s48.p });
  }
  return itens;
}

// ── MÉDIA DE SAÍDA ────────────────────────────────────────────────
async function obterMediaMovi(jar) {
  const map = {};
  const dtFim   = new Date();
  const dtInicio = new Date(); dtInicio.setDate(dtInicio.getDate()-DIAS_MEDIA_MOVI);

  for (const cat of CATEGORIAS_MEDIA) {
    try {
      const pageGet = await req(URLS.mediaMovi,'GET',null,null,jar);
      if (/type="password"/i.test(pageGet.body)) throw new Error('Sessão expirou em consultarMediaMovi2.');
      const vs = (pageGet.body.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/i)||[])[1];
      if (!vs) throw new Error('ViewState não encontrado em consultarMediaMovi2.');

      const postObj = {
        'PrimeiroFrm':'PrimeiroFrm','data':fmtBR(dtInicio),'data2':fmtBR(dtFim),'city2':cat.valor,
        'javax.faces.partial.ajax':'true','javax.faces.source':'j_idt273',
        'javax.faces.partial.execute':'PrimeiroFrm','javax.faces.partial.render':'tbProdutos',
        'javax.faces.behavior.event':'action','javax.faces.partial.event':'click',
        'j_idt273':'j_idt273','javax.faces.ViewState':vs,
      };
      const body = Object.keys(postObj).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(postObj[k])).join('&');
      const resp = await req(URLS.mediaMovi,'POST',{'X-Requested-With':'XMLHttpRequest','Faces-Request':'partial/ajax'},body,jar);

      let htmlTabela = resp.body;
      const upd = resp.body.match(/<update[^>]+id="tbProdutos"[^>]*>([\s\S]*?)<\/update>/i);
      if (upd) htmlTabela = upd[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1');

      const { headers, rows } = parseTabela(htmlTabela);
      const iCod      = headers.findIndex(h=>/c.?d(igo)?/i.test(norm(h)));
      const iRend     = headers.findIndex(h=>/rendimento/i.test(norm(h)));
      const iSaidaSem = headers.findIndex(h=>/saida.*semana|semana.*saida/i.test(norm(h)));
      const iBatSem   = headers.findIndex(h=>/batida.*semana|semana.*batida/i.test(norm(h)));
      const iSaida    = headers.findIndex(h=>/^saida$/i.test(norm(h)));

      if (!rows.length) { console.log(`   ${cat.nome}: sem dados`); continue; }
      let count=0;
      for (const c of rows) {
        const cod = iCod>=0 ? c[iCod]?.trim() : ''; if(!cod||isNaN(Number(cod))) continue;
        const rendimento   = iRend>=0     ? num(c[iRend])     : 0;
        const saidaSemana  = iSaidaSem>=0 ? num(c[iSaidaSem]) : 0;
        const batidaSemana = iBatSem>=0   ? num(c[iBatSem])   : 0;
        const saidaDiaria  = saidaSemana>0 ? saidaSemana/7 : 0;
        if (!map[cod] || rendimento>(map[cod].rendimento||0))
          { map[cod]={rendimento,saidaSemana,saidaDiaria,batidaSemana}; count++; }
      }
      console.log(`   ${cat.nome}: ${count} produtos`);
    } catch(e) { console.error(`   ❌ ${cat.nome}: ${e.message}`); }
  }
  return map;
}

// ── ALERTAS ───────────────────────────────────────────────────────
async function calcularAlertas(itensPA, mediaMovi) {
  const dataCorte = diasAtras(DIAS_MEDIA);
  const alertas = [];
  for (const item of itensPA) {
    const movi = mediaMovi[item.codigo];
    let mediaDiaria = movi?.saidaDiaria || 0;
    let fonte = movi ? 'winthor_media' : null;

    if (!mediaDiaria) {
      const snap = await db.collection('saidasPA').where('codigo','==',item.codigo).get();
      let total=0; const dias=new Set();
      snap.forEach(d => { const x=d.data(); if(x.data>=dataCorte){total+=x.qtd||0;dias.add(x.data);} });
      mediaDiaria = total/(dias.size||1); fonte='historico_saidas';
    }

    const util        = Math.max(0, item.estoqueAtual-(item.estoqueMinimo||0));
    const diasAteMin  = mediaDiaria>0 ? util/mediaDiaria : Infinity;
    const horasAteMin = diasAteMin*24;
    const abaixo      = (item.estoqueMinimo||0)>0 && item.estoqueAtual<=item.estoqueMinimo;

    if (abaixo || horasAteMin<=HORAS_ALERTA) {
      alertas.push({
        codigo:item.codigo, produto:item.produto, estoqueAtual:item.estoqueAtual,
        estoqueMinimo:item.estoqueMinimo||0, unidade:item.unidade,
        rendimentoReal:movi?.rendimento||null, saidaSemana:movi?.saidaSemana||null, batidaSemana:movi?.batidaSemana||null,
        mediaSaidaDiaria:parseFloat((mediaDiaria||0).toFixed(4)), fonteMedia:fonte,
        cobertura48h: mediaDiaria>0 ? parseFloat((util/(mediaDiaria*2)).toFixed(3)) : null,
        horasAteMinimo:parseFloat(horasAteMin.toFixed(1)), diasAteMinimo:parseFloat(diasAteMin.toFixed(2)),
        abaixoDoMinimo:abaixo,
        dataEstimadaRuptura: mediaDiaria>0 ? new Date(Date.now()+diasAteMin*86400000).toISOString() : null,
        alertaCriadoEm:new Date().toISOString(), status:'pendente',
      });
    }
  }
  return alertas;
}

// ── SINCRONIZAÇÃO COMPLETA ────────────────────────────────────────
async function sincronizar() {
  const inicio = Date.now();
  console.log(`\n🔄 [${new Date().toLocaleTimeString('pt-BR')}] Iniciando sincronização...`);
  await db.collection('bridge').doc('status').set({ rodando:true, inicio:new Date().toISOString(), mensagem:'Iniciando...', progresso:0 });

  try {
    // Login
    await setStatus('Fazendo login no portal...', 5);
    const jar = await fazerLogin();
    console.log('   ✅ Login OK');

    // 1. OPs
    await setStatus('Consultando ordens de produção...', 15);
    const ordens = await obterOPs(jar);
    const filtradas = ordens.filter(o=>setorOk(o.CATEGORIA));
    console.log(`   ${filtradas.length}/${ordens.length} OPs no setor [${SETORES_RAW.join(', ')}]`);

    const porData={}, produtos=new Map();
    for (const o of filtradas) {
      const dt=paraISO(o.DATA_PROD), cod=o.CODIGO;
      if(!dt||!cod) continue;
      if(!porData[dt]) porData[dt]=new Map();
      if(!porData[dt].has(cod)) porData[dt].set(cod,{codigo:cod,produto:o.PRODUTO||cod,categoria:o.CATEGORIA||'Sem setor',metaLotes:0,rendimentoTeorico:0,ops:[]});
      const item=porData[dt].get(cod);
      item.metaLotes        += Math.max(1,num(o.RECEITAS));
      item.rendimentoTeorico += o.RENDIMENTO_TOTAL||0;
      item.ops.push(o.NUM_OP);
      produtos.set(cod,{nome:o.PRODUTO||cod,categoria:o.CATEGORIA||'Sem setor'});
    }
    const loteProd=db.batch();
    produtos.forEach((d,c)=>loteProd.set(db.collection('produtos').doc(c),d,{merge:true}));
    await loteProd.commit();
    for (const [dt,mapa] of Object.entries(porData)) {
      const cats={};
      mapa.forEach(i=>{if(!cats[i.categoria])cats[i.categoria]=[];cats[i.categoria].push(i);});
      await db.collection('winthorSugestoes').doc(dt).set({data:dt,atualizadoEm:new Date().toISOString(),categorias:cats});
    }
    console.log(`   ✅ ${Object.keys(porData).length} datas | ${produtos.size} produtos`);

    // 2. Estoque PA
    await setStatus('Consultando estoque de produto acabado...', 35);
    const itensPA = await obterEstoquePA(jar);
    console.log(`   ✅ ${itensPA.length} itens no estoque PA`);

    // 3. Média de saída
    await setStatus('Calculando média de saída...', 55);
    const mediaMovi = await obterMediaMovi(jar);
    console.log(`   ✅ ${Object.keys(mediaMovi).length} produtos com média`);

    // 4. Salvar estoque PA
    // ✅ OTIMIZADO: grava tudo em 2 documentos em vez de N docs + N subdocs
    //    /estoquePA/{codigo}  — mantido para compatibilidade com outras telas
    //    /estoquePA_resumo/atual — lista completa para o PainelTV (1 leitura total)
    await setStatus('Salvando estoque...', 70);
    const itensPAEnriquecidos = itensPA.map(item => {
      const movi = mediaMovi[item.codigo] || {};
      return {
        ...item,
        atualizadoEm:     new Date().toISOString(),
        rendimentoReal:   movi.rendimento    || null,
        saidaSemana:      movi.saidaSemana   || null,
        mediaSaidaDiaria: movi.saidaDiaria   || null,
        batidaSemana:     movi.batidaSemana  || null,
        coberturaDias:    movi.saidaDiaria > 0
          ? parseFloat((item.estoqueAtual / movi.saidaDiaria).toFixed(2)) : null,
      };
    });

    // Grava cada produto individualmente (para telas que lêem por código)
    const BATCH_SIZE = 400;
    for (let i = 0; i < itensPAEnriquecidos.length; i += BATCH_SIZE) {
      const lotePA = db.batch();
      for (const item of itensPAEnriquecidos.slice(i, i + BATCH_SIZE)) {
        lotePA.set(db.collection('estoquePA').doc(item.codigo), item, { merge: true });
      }
      await lotePA.commit();
    }

    // ✅ Doc resumo único para o PainelTV — substitui onSnapshot na coleção inteira
    await db.collection('estoquePA_resumo').doc('atual').set({
      itens:        itensPAEnriquecidos,
      atualizadoEm: new Date().toISOString(),
      total:        itensPAEnriquecidos.length,
    });
    console.log(`   ✅ ${itensPA.length} itens salvos em /estoquePA + resumo em /estoquePA_resumo/atual`);

    // 5. Alertas
    await setStatus('Calculando alertas de ruptura...', 85);
    const alertas = await calcularAlertas(itensPA, mediaMovi);
    if (alertas.length>0) {
      const loteA=db.batch();
      for (const a of alertas) {
        loteA.set(db.collection('alertasEstoque').doc(a.codigo),a);
        console.log(`   ${a.abaixoDoMinimo?'🔴':'⚠️ '} ${a.produto} — ${a.horasAteMinimo.toFixed(0)}h até mínimo`);
      }
      await loteA.commit();
    }
    const codsAlerta=new Set(alertas.map(a=>a.codigo));
    const snapA=await db.collection('alertasEstoque').where('status','==','pendente').get();
    if(!snapA.empty){const lR=db.batch();let n=0;snapA.forEach(d=>{if(!codsAlerta.has(d.id)){lR.update(d.ref,{status:'resolvido',resolvidoEm:new Date().toISOString()});n++;}});if(n>0){await lR.commit();console.log(`   ✅ ${n} alerta(s) resolvido(s)`);}}
    console.log(`   ${alertas.length>0?alertas.length+' alerta(s) ativo(s)':'✅ Nenhum alerta'}`);

    // 6. Exportar catálogo local
    try {
      const dir='C:\\Câmara de avarias';
      if(fs.existsSync(dir)){
        const cat=[...produtos.entries()].map(([c,d])=>({codigo:c,nome:d.nome,unidade:'UN'})).sort((a,b)=>a.nome.localeCompare(b.nome));
        fs.writeFileSync(path.join(dir,'winthor_produtos.json'),JSON.stringify(cat,null,2),'utf8');
        fs.writeFileSync(path.join(dir,'winthor_produtos.js'),`window.winthorProdutos = ${JSON.stringify(cat,null,2)};`,'utf8');
        console.log(`   ✅ ${cat.length} produtos exportados para Câmara de avarias`);
      }
    } catch(e){console.error('   ❌ Exportação local:',e.message);}

    const duracao=((Date.now()-inicio)/1000).toFixed(1);
    await db.collection('bridge').doc('status').set({
      rodando:false, mensagem:`✅ Sincronização concluída em ${duracao}s`,
      progresso:100, ultimaSincronizacao:new Date().toISOString(),
    });
    console.log(`\n✅ Concluído em ${duracao}s`);

  } catch(e) {
    console.error('❌ Erro:', e.message, e.stack);
    await db.collection('bridge').doc('status').set({
      rodando:false, mensagem:`❌ Erro: ${e.message}`, progresso:0, erroEm:new Date().toISOString(),
    });
  }
}

// ── AGENDAMENTO ÀS 11H ────────────────────────────────────────────
function agendarProximas11h() {
  const agora=new Date(), alvo=new Date();
  alvo.setHours(11,0,0,0);
  if(alvo<=agora) alvo.setDate(alvo.getDate()+1);
  const ms=alvo-agora;
  const hh=Math.floor(ms/3600000), mm=Math.floor((ms%3600000)/60000);
  console.log(`⏰ Próxima sincronização automática em ${hh}h${mm}min (${alvo.toLocaleString('pt-BR')})`);
  setTimeout(async()=>{ await sincronizar(); agendarProximas11h(); }, ms);
}

// ── LISTENER: BOTÃO SINCRONIZAR DO WMS ───────────────────────────
function escutarComando() {
  db.collection('bridge').doc('comando').onSnapshot(async snap => {
    if (!snap.exists) return;
    const dado = snap.data();
    if (dado?.acao !== 'sincronizar' || !dado?.solicitadoEm) return;
    const status = (await db.collection('bridge').doc('status').get()).data();
    if (status?.ultimoComando === dado.solicitadoEm) return; // já processado
    await db.collection('bridge').doc('status').set({ ultimoComando:dado.solicitadoEm }, { merge:true });
    console.log('\n📲 Sincronização manual solicitada pelo WMS');
    await sincronizar();
  });
  console.log('👂 Aguardando comandos do WMS via Firestore...');
}

// ── START ─────────────────────────────────────────────────────────
console.log('🌉 Bridge Winthor → Firestore');
console.log(`   Portal: ${PORTAL_BASE} (${P_USUARIO})`);
console.log(`   Setores: ${SETORES_RAW.join(', ')} | Média: ${DIAS_MEDIA_MOVI} dias | Alerta: ${HORAS_ALERTA}h`);
console.log('   Ctrl+C para parar.\n');
escutarComando();
agendarProximas11h();
