import { useState, useEffect } from 'react';
import { collection, onSnapshot, getDocs, getDoc, doc, writeBatch, increment } from 'firebase/firestore';
import { db, dbEstoqueOS } from '../services/firebase';
import { useAuth } from '../services/auth';
import { useProdutos } from '../services/hooks';

// ── Hook: Estoque PA Winthor (bridge) ─────────────────────────────
function useEstoqueWinthorPA() {
  const [dados, setDados] = useState({});
  const [atualizadoEm, setAtualizadoEm] = useState(null);
  useEffect(() => {
    return onSnapshot(collection(db, 'estoquePA'), snap => {
      const mapa = {};
      let ultima = '';
      snap.forEach(d => {
        const item = d.data();
        const chave = (item.codigo || '').trim();
        if (chave) mapa[chave] = { ...item, id: d.id };
        if (item.atualizadoEm && item.atualizadoEm > ultima) ultima = item.atualizadoEm;
      });
      setDados(mapa);
      if (ultima) setAtualizadoEm(ultima);
    });
  }, []);
  return { dados, atualizadoEm };
}

// ── Hook: Estoque PA Físico (entradas da expedição) ───────────────
function useEstoquePAFisico() {
  const [dados, setDados] = useState({});
  useEffect(() => {
    return onSnapshot(collection(db, 'estoquePAFisico'), snap => {
      const mapa = {};
      snap.forEach(d => { mapa[d.id] = { ...d.data(), id: d.id }; });
      setDados(mapa);
    });
  }, []);
  return dados;
}

// ── Helpers ───────────────────────────────────────────────────────
function fmtQtd(n, un) {
  if (n == null || !isFinite(n)) return '—';
  return `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${un || 'UN'}`;
}
function horaCurta(iso) {
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

// ── Métrica individual (label pequena + valor) ────────────────────
function Metrica({ label, valor, cor, destaque }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#b08d55', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: destaque ? '1rem' : '0.88rem', fontWeight: 800, color: cor || 'var(--marrom)', whiteSpace: 'nowrap' }}>{valor}</span>
    </div>
  );
}

// ── Badge de cobertura ─────────────────────────────────────────────
// Usa coberturaDias (dias = estoque ÷ média diária real do Winthor) quando
// disponível. Cai para o cálculo antigo (% da demanda 24+48h) como fallback.
function BadgeCobertura({ disponivel, demanda, coberturaDias }) {
  // Caminho 1: coberturaDias vem da bridge (mais preciso — usa média real)
  if (coberturaDias != null) {
    let cor, bg, texto, icone;
    if (coberturaDias >= 3)        { cor = '#166534'; bg = '#f0fdf4'; icone = 'ph-check-circle'; texto = `Cobre ${coberturaDias.toFixed(1)} dias`; }
    else if (coberturaDias >= 2)   { cor = '#166534'; bg = '#f0fdf4'; icone = 'ph-check-circle'; texto = `Cobre ${coberturaDias.toFixed(1)} dias`; }
    else if (coberturaDias >= 1)   { cor = '#92400e'; bg = '#fef3c7'; icone = 'ph-warning';      texto = `Atenção: ${coberturaDias.toFixed(1)} dias`; }
    else                           { cor = '#991b1b'; bg = '#fef2f2'; icone = 'ph-warning-circle'; texto = `Crítico: < 1 dia`; }
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: bg, color: cor, fontSize: '0.75rem', fontWeight: 800, padding: '5px 12px', borderRadius: 20 }}>
        <i className={`ph ${icone}`}></i> {texto}
      </div>
    );
  }

  // Caminho 2: fallback pelo percentual da demanda 24+48h
  if (demanda == null || demanda <= 0 || disponivel == null) return null;
  const percCobertura = (disponivel / demanda) * 100;
  let cor, bg, texto, icone;
  if (percCobertura >= 130)      { cor = '#166534'; bg = '#f0fdf4'; icone = 'ph-check-circle'; texto = 'Cobre a demanda'; }
  else if (percCobertura >= 100) { cor = '#166534'; bg = '#f0fdf4'; icone = 'ph-check-circle'; texto = 'Cobre (folga baixa)'; }
  else if (percCobertura >= 60)  { cor = '#92400e'; bg = '#fef3c7'; icone = 'ph-warning';      texto = `Cobre ${percCobertura.toFixed(0)}% — atenção`; }
  else                           { cor = '#991b1b'; bg = '#fef2f2'; icone = 'ph-warning-circle'; texto = `Insuficiente (${percCobertura.toFixed(0)}%)`; }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: bg, color: cor, fontSize: '0.75rem', fontWeight: 800, padding: '5px 12px', borderRadius: 20 }}>
      <i className={`ph ${icone}`}></i> {texto}
    </div>
  );
}

// ── Modal de Ajuste Físico PA (só PCP) ───────────────────────────
function ModalAjusteFisico({ item, aoFechar }) {
  const [modo, setModo] = useState('ajuste');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);

  const saldoAtual = item?.fisico?.saldoFisico || 0;
  const unidade    = item?.fisico?.unidade || item?.winthor?.unidade || 'UN';
  const codigo     = item.codigo;
  const produto    = item.produto;

  async function salvar() {
    if (!valor || isNaN(parseFloat(valor))) return alert('Insira um valor válido.');
    if (!motivo.trim()) return alert('Informe o motivo do ajuste.');
    setSalvando(true);
    try {
      const n = parseFloat(valor);
      let delta = 0, tipo = '';
      if (modo === 'ajuste') { delta = n - saldoAtual; tipo = 'AJUSTE_INVENTARIO'; }
      else if (modo === 'entrada') { delta = n; tipo = 'ENTRADA_MANUAL'; }
      else { delta = -n; tipo = 'SAIDA_MANUAL'; }

      const batch = writeBatch(db);
      const refSaldo = doc(db, 'estoquePAFisico', codigo);
      batch.set(refSaldo, { codigo, produto, saldoFisico: increment(delta), unidade, ultimoAjuste: new Date().toISOString() }, { merge: true });
      const refMov = doc(collection(db, 'estoquePAFisico', codigo, 'ajustes'));
      batch.set(refMov, { tipo, saldoAntes: saldoAtual, valor: n, delta, motivo: motivo.trim(), registradoEm: new Date().toISOString() });
      await batch.commit();
      alert('Ajuste salvo!');
      aoFechar();
    } catch (e) { alert('Erro: ' + e.message); }
    finally { setSalvando(false); }
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-end' }} onClick={aoFechar}>
      <div style={{ background: 'white', width: '100%', maxWidth: 500, margin: '0 auto', borderRadius: '20px 20px 0 0', padding: 24, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--marrom)' }}>{produto}</div>
            <div style={{ fontSize: '0.75rem', color: '#999', marginTop: 2 }}>CÓD: {codigo} · Saldo atual: {fmtQtd(saldoAtual, unidade)}</div>
          </div>
          <button onClick={aoFechar} style={{ background: 'none', border: 'none', fontSize: '1.4rem', color: '#999', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {[['ajuste', '🎯 Inventário'], ['entrada', '📥 Entrada'], ['saida', '📤 Saída']].map(([m, label]) => (
            <button key={m} onClick={() => setModo(m)} style={{ flex: 1, padding: '10px 8px', borderRadius: 10, border: '2px solid', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', background: modo === m ? 'var(--amarelo)' : 'white', borderColor: modo === m ? 'var(--amarelo)' : 'var(--border-suave)', color: modo === m ? 'var(--marrom)' : '#999' }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ background: 'var(--amarelo-claro)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: '0.82rem', color: 'var(--marrom)' }}>
          {modo === 'ajuste' && <><strong>Inventário:</strong> informe o saldo real contado — o sistema calcula a diferença automaticamente.</>}
          {modo === 'entrada' && <><strong>Entrada manual:</strong> quantidade a adicionar ao saldo.</>}
          {modo === 'saida'  && <><strong>Saída manual:</strong> quantidade a remover do saldo.</>}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>
            {modo === 'ajuste' ? `Saldo real contado (${unidade})` : `Quantidade (${unidade})`}
          </label>
          <input type="number" step="0.01" min="0" className="input-texto" value={valor} onChange={e => setValor(e.target.value)} placeholder={modo === 'ajuste' ? `Saldo atual: ${saldoAtual.toFixed(2)}` : '0.00'} />
          {modo === 'ajuste' && valor && !isNaN(parseFloat(valor)) && (
            <div style={{ marginTop: 6, fontSize: '0.82rem', fontWeight: 700, color: parseFloat(valor) - saldoAtual >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              Diferença: {parseFloat(valor) - saldoAtual >= 0 ? '+' : ''}{(parseFloat(valor) - saldoAtual).toFixed(2)} {unidade}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--marrom)', marginBottom: 6 }}>Motivo / Observação</label>
          <input className="input-texto" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex: Contagem física de câmara, Descarte por vencimento..." />
        </div>

        <button onClick={salvar} disabled={salvando} style={{ width: '100%', padding: 16, borderRadius: 12, border: 'none', background: 'var(--marrom)', color: 'white', fontWeight: 900, fontSize: '1rem', cursor: 'pointer' }}>
          {salvando ? 'Salvando...' : 'Confirmar Ajuste'}
        </button>
      </div>
    </div>
  );
}

// ── Modal Lotes (compartilhado PA e MP) ───────────────────────────
function ModalLotes({ produto, aoFechar }) {
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', zIndex: 9999 }} onClick={aoFechar}>
      <div style={{ background: 'white', borderRadius: 24, width: '100%', maxWidth: 420, maxHeight: '70vh', overflow: 'hidden', margin: 16 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--border-suave)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><h2 style={{ fontWeight: 900, fontSize: '1.3rem' }}>{produto.nome}</h2><div style={{ fontSize: '0.75rem', color: '#999' }}>CÓD: {produto.codigo || 'N/A'}</div></div>
          <button style={{ background: 'none', border: 'none', fontSize: '1.4rem', color: '#999', cursor: 'pointer' }} onClick={aoFechar}>✕</button>
        </div>
        <div style={{ padding: 12, maxHeight: '50vh', overflowY: 'auto' }}>
          {(produto.lotes || []).length === 0
            ? <div className="status-msg">Nenhum lote encontrado.</div>
            : (produto.lotes || []).map((lt, lIdx) => (
                <div key={lIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottom: '1px solid #f3f4f6' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{lt.lote || lt.loteFisico || lt.batchNumber || lt.code || 'S/N'}</div>
                    <div style={{ fontSize: '0.75rem', color: '#999' }}>{(lt.validade || lt.expiryDate) ? new Date(lt.validade || lt.expiryDate).toLocaleDateString('pt-BR') : 'Sem validade'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>{parseFloat(lt.qtd || lt.quantity || 0).toFixed(2)}</div>
                    <div style={{ fontSize: '0.75rem', color: '#999' }}>{produto.und || lt.und || 'kg'}</div>
                  </div>
                </div>
              ))
          }
        </div>
        <div style={{ padding: 14, background: '#fafafa', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: '#999' }}>Total</span>
          <span style={{ fontWeight: 900, color: 'var(--amarelo)', fontSize: '1.2rem' }}>
            {((produto.totalKg || 0) > 0 ? produto.totalKg.toFixed(2) : (produto.totalUnd || 0) > 0 ? produto.totalUnd : (produto.totalFisico || 0).toFixed(2))} {produto.und || 'kg'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Chips de resumo (compartilhado) ───────────────────────────────
function ChipsResumo({ criticos, avisos, atualizadoEm, labelFonte }) {
  if (criticos === 0 && avisos === 0 && !atualizadoEm) return null;
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
      {criticos > 0 && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fde8e8', color: '#c0392b', padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.8rem' }}>
          <i className="ph ph-warning-circle"></i> {criticos} crítico{criticos > 1 ? 's' : ''}
        </div>
      )}
      {avisos > 0 && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fef3e2', color: '#e67e22', padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.8rem' }}>
          <i className="ph ph-warning"></i> {avisos} aviso{avisos > 1 ? 's' : ''}
        </div>
      )}
      {atualizadoEm && (
        <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: '#a78355', fontWeight: 600 }}>
          <i className="ph ph-arrows-clockwise"></i> {labelFonte} {horaCurta(atualizadoEm)}
        </div>
      )}
    </div>
  );
}

// ── CARD SÓLIDO — mesmo layout para PA e MP ───────────────────────
function CardEstoque({ icone, produto, codigo, tagQtd, metricas, coberturaEl, onClick, onAjustar, borderColor }) {
  return (
    <div style={{
      border: `1px solid ${borderColor || '#f0e3c4'}`,
      borderLeft: `4px solid ${borderColor || '#f5b915'}`,
      borderRadius: 14,
      marginBottom: 10,
      background: 'white',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(107,68,35,0.04)',
    }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px 12px', cursor: onClick ? 'pointer' : 'default' }}
        onClick={onClick}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--amarelo-claro)', color: 'var(--amarelo)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '1.15rem' }}>
            <i className={`ph ${icone}`}></i>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, color: 'var(--marrom)', fontSize: '0.98rem' }}>{produto}</div>
            <div style={{ fontSize: '0.7rem', color: '#b08d55', fontFamily: 'monospace', marginTop: 1, fontWeight: 600 }}>CÓD: {codigo}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {tagQtd}
          {onAjustar && (
            <button
              onClick={e => { e.stopPropagation(); onAjustar(); }}
              style={{ background: 'var(--amarelo-claro)', border: '1px solid var(--amarelo)', borderRadius: 8, padding: '6px 10px', fontWeight: 700, fontSize: '0.72rem', color: 'var(--marrom)', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              <i className="ph ph-sliders"></i>
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 22, padding: '10px 16px 12px', borderTop: '1px dashed #f0e3c4', flexWrap: 'wrap' }}>
        {metricas}
      </div>

      {coberturaEl && <div style={{ padding: '0 16px 14px' }}>{coberturaEl}</div>}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────
export default function Estoque() {
  const { currentUser } = useAuth();
  const { produtos } = useProdutos();
  const isPcp = currentUser?.setor === 'pcp';

  const [estoqueAtual, setEstoqueAtual] = useState([]);
  const [termoBusca, setTermoBusca]     = useState('');
  const [subAba, setSubAba]             = useState('acabado');
  const [modalLotes, setModalLotes]     = useState(null);
  const [modalAjuste, setModalAjuste]   = useState(null);
  const [categoriaAtiva, setCategoriaAtiva] = useState('Todas');

  const [estoqueWinthorSistema, setEstoqueWinthorSistema] = useState({});
  const [estoqueMP, setEstoqueMP]       = useState([]);
  const [carregandoMP, setCarregandoMP] = useState(false);

  const { dados: winthorPA, atualizadoEm: paAtualizadoEm } = useEstoqueWinthorPA();
  const fisicoPA = useEstoquePAFisico();

  useEffect(() => {
    return onSnapshot(collection(db, 'estoque'), snap => {
      const est = [];
      snap.forEach(d => est.push({ ...d.data(), id: d.id }));
      setEstoqueAtual(est);
    });
  }, []);

  useEffect(() => {
    if (subAba === 'mp' && isPcp) {
      setCarregandoMP(true);
      (async () => {
        try {
          const winRef = await getDocs(collection(db, 'winthorEstoqueSistema'));
          const winthorData = {};
          winRef.forEach(d => { winthorData[d.id] = d.data().saldoWinthor || 0; });
          setEstoqueWinthorSistema(winthorData);

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
  }, [subAba, isPcp]);

  const lotesPorCodigo = {};
  estoqueAtual.forEach(it => {
    const cod = it.codigo || it.nome;
    if (!lotesPorCodigo[cod]) lotesPorCodigo[cod] = { nome: it.nome, codigo: it.codigo, totalKg: 0, totalUnd: 0, lotes: [], und: it.und };
    if (it.und === 'kg') lotesPorCodigo[cod].totalKg += parseFloat(it.qtd || 0);
    else lotesPorCodigo[cod].totalUnd += parseFloat(it.qtd || 0);
    lotesPorCodigo[cod].lotes.push(it);
  });

  const todasChaves = new Set([...Object.keys(winthorPA), ...Object.keys(fisicoPA)]);
  let listaAcabado = Array.from(todasChaves).map(codigo => {
    const w = winthorPA[codigo];
    const f = fisicoPA[codigo];
    const lotesGrp = lotesPorCodigo[codigo] || lotesPorCodigo[w?.produto] || null;
    // categoria vem do estoquePA gravado pela bridge (campo `categoria`)
    const categoria = w?.categoria || f?.categoria || 'Sem categoria';
    return { codigo, produto: w?.produto || f?.produto || codigo, winthor: w || null, fisico: f || null, lotesGrp, categoria };
  });

  // Categorias únicas para os chips de filtro
  const categorias = ['Todas', ...Array.from(new Set(listaAcabado.map(g => g.categoria))).sort((a, b) => a.localeCompare(b, 'pt-BR'))];

  if (termoBusca && subAba === 'acabado') {
    const t = termoBusca.toLowerCase();
    listaAcabado = listaAcabado.filter(g => g.produto.toLowerCase().includes(t) || g.codigo.toLowerCase().includes(t));
  }

  // Filtro por categoria (só quando não há busca ativa)
  if (!termoBusca && categoriaAtiva !== 'Todas') {
    listaAcabado = listaAcabado.filter(g => g.categoria === categoriaAtiva);
  }

  function classificar(g) {
    const w = g.winthor;
    if (!w) return 2;

    // ── Prioridade 1: coberturaDias gravada pela bridge (usa média real do Winthor) ──
    // coberturaDias = estoqueAtual ÷ mediaSaidaDiaria
    // < 1 dia → crítico | 1–2 dias → aviso | > 2 dias → ok
    if (w.coberturaDias != null) {
      if (w.coberturaDias < 1)  return 0; // crítico
      if (w.coberturaDias < 2)  return 1; // aviso
      return 2;
    }

    // ── Fallback: usa saída 24h+48h (comportamento anterior) ──
    const disponivel = w.estoqueAtual ?? 0;
    const demanda    = (w.saida24h || 0) + (w.saida48h || 0);
    if (demanda <= 0) return 2;
    const perc = (disponivel / demanda) * 100;
    if (perc < 60)  return 0;
    if (perc < 100) return 1;
    return 2;
  }

  listaAcabado.sort((a, b) => {
    const nA = classificar(a), nB = classificar(b);
    if (nA !== nB) return nA - nB;
    return a.produto.localeCompare(b.produto, 'pt-BR');
  });

  const totalCriticos = listaAcabado.filter(g => classificar(g) === 0).length;
  const totalAvisos   = listaAcabado.filter(g => classificar(g) === 1).length;

  let mpFiltrado = estoqueMP;
  if (termoBusca && subAba === 'mp') {
    const t = termoBusca.toLowerCase();
    mpFiltrado = estoqueMP.filter(g => g.nome.toLowerCase().includes(t) || (g.codigo && g.codigo.toLowerCase().includes(t)));
  }

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid var(--border-suave)' }}>
        <h2 style={{ fontWeight: 900, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="ph ph-package" style={{ fontSize: '1.8rem', color: 'var(--amarelo)' }}></i>Gestão de Estoques
        </h2>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 className="nome">Painel de Estoque</h3>
          {isPcp && (
            <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 8, padding: 4 }}>
              <button onClick={() => { setSubAba('acabado'); setTermoBusca(''); setCategoriaAtiva('Todas'); }} style={{ padding: '8px 16px', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', border: 'none', cursor: 'pointer', background: subAba === 'acabado' ? 'white' : 'transparent', color: subAba === 'acabado' ? 'var(--marrom)' : '#999', boxShadow: subAba === 'acabado' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                🧊 Produto Acabado
              </button>
              <button onClick={() => { setSubAba('mp'); setTermoBusca(''); setCategoriaAtiva('Todas'); }} style={{ padding: '8px 16px', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', border: 'none', cursor: 'pointer', background: subAba === 'mp' ? 'white' : 'transparent', color: subAba === 'mp' ? 'var(--marrom)' : '#999', boxShadow: subAba === 'mp' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                📦 Matéria Prima
              </button>
            </div>
          )}
        </div>

        {subAba === 'acabado' && (
          <ChipsResumo criticos={totalCriticos} avisos={totalAvisos} atualizadoEm={paAtualizadoEm} labelFonte="Winthor" />
        )}

        {/* ── Chips de categoria — só aparecem na aba PA e sem busca ativa ── */}
        {subAba === 'acabado' && !termoBusca && categorias.length > 2 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {categorias.map(cat => {
              const ativa = categoriaAtiva === cat;
              const count = cat === 'Todas'
                ? listaAcabado.length + (categoriaAtiva !== 'Todas' ? 0 : 0) // usa o total antes do filtro
                : Array.from(todasChaves).filter(cod => {
                    const w = winthorPA[cod]; const f = fisicoPA[cod];
                    return (w?.categoria || f?.categoria || 'Sem categoria') === cat;
                  }).length;
              return (
                <button
                  key={cat}
                  onClick={() => setCategoriaAtiva(cat)}
                  style={{
                    padding: '6px 14px', borderRadius: 20, border: '1.5px solid',
                    borderColor: ativa ? 'var(--amarelo-escuro)' : 'var(--border-forte)',
                    background: ativa ? 'var(--amarelo)' : 'white',
                    color: ativa ? 'var(--marrom)' : 'var(--marrom-claro)',
                    fontWeight: ativa ? 800 : 600, fontSize: '0.78rem',
                    cursor: 'pointer', transition: 'all 0.12s',
                  }}
                >
                  {cat}
                  <span style={{ marginLeft: 5, fontWeight: 900, opacity: 0.7 }}>
                    {cat === 'Todas'
                      ? Array.from(todasChaves).length
                      : count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <input type="text" className="input-texto" placeholder="Buscar por nome ou código..." value={termoBusca} onChange={e => setTermoBusca(e.target.value)} />
        </div>

        {/* ── ABA: PRODUTO ACABADO ── */}
        {subAba === 'acabado' && (
          listaAcabado.length === 0
            ? <div className="status-msg">Nenhum produto encontrado.</div>
            : <div>
                {listaAcabado.map(grp => {
                  const { codigo, produto, winthor: w, fisico: f, lotesGrp } = grp;
                  const nivel = classificar(grp);
                  const borderColor = nivel === 0 ? '#c0392b' : nivel === 1 ? '#e67e22' : '#e8dcc0';

                  const saldoFisico = f?.saldoFisico ?? (lotesGrp ? (lotesGrp.und === 'kg' ? lotesGrp.totalKg : lotesGrp.totalUnd) : null);
                  const unidade = w?.unidade || f?.unidade || 'UN';
                  const disponivelWinthor = w?.estoqueAtual;
                  const demanda = w ? (w.saida24h || 0) + (w.saida48h || 0) : null;
                  const corWinthor = nivel === 0 ? '#c0392b' : nivel === 1 ? '#e67e22' : '#3d8b53';

                  const metricas = (
                    <>
                      <Metrica label="Winthor" valor={w ? fmtQtd(w.estoqueAtual, w.unidade) : '—'} cor={corWinthor} destaque />
                      <Metrica label="Físico" valor={saldoFisico != null ? fmtQtd(saldoFisico, unidade) : '—'} destaque />
                      <Metrica label="Saída 24h" valor={w?.saida24h != null ? fmtQtd(w.saida24h, w.unidade) : '—'} />
                      <Metrica label="Saída 48h" valor={w?.saida48h != null ? fmtQtd(w.saida48h, w.unidade) : '—'} />
                      {demanda != null && demanda > 0 && (
                        <Metrica label="Demanda 24+48h" valor={fmtQtd(demanda, w.unidade)} cor="#a78355" />
                      )}
                      {/* ── Novos campos vindos do consultarMediaMovi2 ── */}
                      {w?.rendimentoReal != null && (
                        <Metrica label="Rendimento" valor={`${w.rendimentoReal} ${w.unidade || 'kg'}/bat.`} cor="#7c3aed" />
                      )}
                      {w?.mediaSaidaDiaria != null && w.mediaSaidaDiaria > 0 && (
                        <Metrica label="Média/dia" valor={fmtQtd(w.mediaSaidaDiaria, w.unidade)} cor="#0369a1" />
                      )}
                      {w?.coberturaDias != null && (
                        <Metrica
                          label="Cobertura"
                          valor={`${w.coberturaDias.toFixed(1)} dias`}
                          cor={w.coberturaDias < 1 ? '#c0392b' : w.coberturaDias < 2 ? '#e67e22' : '#166534'}
                        />
                      )}
                      {w?.batidaSemana != null && w.batidaSemana > 0 && (
                        <Metrica label="Batidas/sem." valor={w.batidaSemana.toFixed(1)} cor="#92400e" />
                      )}
                    </>
                  );

                  // Sempre permite abrir o modal de lotes — mesmo sem lote físico ainda registrado
                  const lotesParaModal = lotesGrp || { nome: produto, codigo, und: unidade, lotes: [], totalKg: 0, totalUnd: 0 };
                  const qtdLotes = lotesGrp?.lotes?.length || 0;

                  return (
                    <CardEstoque
                      key={codigo}
                      icone="ph-package"
                      produto={produto}
                      codigo={codigo}
                      borderColor={borderColor}
                      metricas={metricas}
                      onClick={() => setModalLotes(lotesParaModal)}
                      tagQtd={
                        <span
                          style={{ fontSize: '0.68rem', color: qtdLotes > 0 ? '#a78355' : '#c4b494', fontWeight: 700, background: '#faf6ea', padding: '4px 8px', borderRadius: 8 }}
                        >
                          {qtdLotes > 0 ? `${qtdLotes} lote${qtdLotes > 1 ? 's' : ''}` : 'ver lotes'}
                        </span>
                      }
                      onAjustar={isPcp ? () => setModalAjuste({ codigo, produto, winthor: w, fisico: f }) : null}
                      coberturaEl={<BadgeCobertura disponivel={disponivelWinthor} demanda={demanda} coberturaDias={w?.coberturaDias ?? null} />}
                    />
                  );
                })}
              </div>
        )}

        {/* ── ABA: MATÉRIA PRIMA — mesmo layout sólido ── */}
        {subAba === 'mp' && isPcp && (
          carregandoMP
            ? <div className="status-msg" style={{ fontWeight: 700 }}>Carregando conciliação...</div>
            : mpFiltrado.length === 0
              ? <div className="status-msg">Nenhum item encontrado.</div>
              : <div>
                  {mpFiltrado.map((grp, gIdx) => {
                    const sysQtd = estoqueWinthorSistema[grp.codigo] || 0;
                    const dif = grp.totalFisico - sysQtd;
                    const difPerc = sysQtd > 0 ? ((dif / sysQtd) * 100) : (dif > 0 ? 100 : 0);
                    let nivel = 2, corDif;
                    if (dif > 0.01)      { nivel = 1; corDif = '#92400e'; }
                    else if (dif < -0.01){ nivel = 1; corDif = '#991b1b'; }
                    else                 { nivel = 2; corDif = '#166534'; }
                    const borderColor = nivel === 1 ? '#e67e22' : '#e8dcc0';
                    const difStr = dif > 0.01 ? `+${difPerc.toFixed(1)}%` : dif < -0.01 ? `${difPerc.toFixed(1)}%` : 'Bateu';

                    const metricas = (
                      <>
                        <Metrica label="Físico OS" valor={fmtQtd(grp.totalFisico, grp.und)} destaque />
                        <Metrica label="Winthor" valor={fmtQtd(sysQtd, grp.und)} destaque />
                        <Metrica label="Diferença" valor={difStr} cor={corDif} />
                      </>
                    );

                    return (
                      <CardEstoque
                        key={gIdx}
                        icone="ph-box-arrow-down"
                        produto={grp.nome}
                        codigo={grp.codigo}
                        borderColor={borderColor}
                        metricas={metricas}
                        onClick={() => setModalLotes(grp)}
                        tagQtd={grp.lotes.length > 0 && (
                          <span style={{ fontSize: '0.68rem', color: '#a78355', fontWeight: 700, background: '#faf6ea', padding: '4px 8px', borderRadius: 8 }}>
                            {grp.lotes.length} lote{grp.lotes.length > 1 ? 's' : ''}
                          </span>
                        )}
                      />
                    );
                  })}
                </div>
        )}
      </div>

      {modalLotes && <ModalLotes produto={modalLotes} aoFechar={() => setModalLotes(null)} />}
      {modalAjuste && isPcp && <ModalAjusteFisico item={modalAjuste} aoFechar={() => setModalAjuste(null)} />}
    </div>
  );
}
