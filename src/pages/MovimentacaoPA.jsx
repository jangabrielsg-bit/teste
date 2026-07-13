import { useState, useEffect, useMemo } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, query, orderBy, where, limit } from 'firebase/firestore';
import { db } from '../services/firebase';
import { formatarKg } from '../services/utils';

const MINUTOS_ATE_ALERTA = 30;

function formatarDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function hoje() { return new Date().toISOString().slice(0, 10); }
function ontemISO() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }

export default function MovimentacaoPA() {
  const [aba, setAba] = useState('saidas');
  const [busca, setBusca] = useState('');
  const [saidas, setSaidas] = useState([]);
  const [entradas, setEntradas] = useState([]);
  const [ultimaSync, setUltimaSync] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [agora, setAgora] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // ── Saídas: dados reais raspados do Winthor (movInicial + movInicialInterior) ──
  useEffect(() => {
    const dataHoje = hoje();
    const q = query(collection(db, 'saidasPA'), where('data', '==', dataHoje));
    const unsub = onSnapshot(q, snap => {
      const lista = [];
      snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
      lista.sort((a, b) => (a.produto || '').localeCompare(b.produto || '', 'pt-BR'));
      setSaidas(lista);
      setCarregando(false);
    }, () => setCarregando(false));
    return unsub;
  }, []);

  // ── Entradas: estimativa por diff ────────────────────────────────
  // entrada_hoje ≈ estoque_hoje − estoque_ontem + saidas_hoje
  // Granularidade = ciclo da bridge (~3 min). Não é um log de NF,
  // é uma estimativa de quanto entrou desde ontem.
  useEffect(() => {
    if (aba !== 'entradas') return;
    let ativo = true;
    (async () => {
      setCarregando(true);
      try {
        const dataHoje = hoje();
        const dataOntem = ontemISO();

        const snapEstoque = await getDocs(collection(db, 'estoquePA'));
        const estoqueAtual = {};
        let syncEm = null;
        snapEstoque.forEach(d => {
          const dados = d.data();
          estoqueAtual[d.id] = dados;
          if (dados.atualizadoEm && (!syncEm || dados.atualizadoEm > syncEm)) syncEm = dados.atualizadoEm;
        });
        if (syncEm && ativo) setUltimaSync(syncEm);

        // Busca histórico de ontem por produto
        const saldosOntem = {};
        await Promise.all(
          Object.keys(estoqueAtual).map(async codigo => {
            try {
              const hDoc = await getDoc(doc(db, 'estoquePA', codigo, 'historico', dataOntem));
              saldosOntem[codigo] = hDoc.exists() ? (hDoc.data().estoqueAtual ?? null) : null;
            } catch { saldosOntem[codigo] = null; }
          })
        );

        // Saídas de hoje (para a fórmula)
        const snapSaidas = await getDocs(query(collection(db, 'saidasPA'), where('data', '==', dataHoje)));
        const saidasHoje = {};
        snapSaidas.forEach(d => {
          const dado = d.data();
          saidasHoje[dado.codigo] = (saidasHoje[dado.codigo] || 0) + (dado.qtd || 0);
        });

        const lista = [];
        for (const [codigo, item] of Object.entries(estoqueAtual)) {
          const atual = item.estoqueAtual ?? 0;
          const ontemVal = saldosOntem[codigo];
          if (ontemVal === null || ontemVal === undefined) continue;
          const saidaHoje = saidasHoje[codigo] || 0;
          const entradaEst = atual - ontemVal + saidaHoje;
          if (entradaEst < 0.01) continue;
          lista.push({
            codigo, produto: item.produto || codigo, unidade: item.unidade || 'UN',
            estoqueOntem: ontemVal, estoqueAtual: atual, saidaHoje,
            entradaEst: Math.round(entradaEst * 100) / 100,
          });
        }

        lista.sort((a, b) => b.entradaEst - a.entradaEst);
        if (ativo) { setEntradas(lista); setCarregando(false); }
      } catch (e) {
        console.error('Erro ao calcular entradas:', e);
        if (ativo) setCarregando(false);
      }
    })();
    return () => { ativo = false; };
  }, [aba]);

  // Heartbeat da bridge (vem do estoquePA)
  useEffect(() => {
    if (aba !== 'saidas') return;
    const unsub = onSnapshot(query(collection(db, 'estoquePA'), limit(1)), snap => {
      snap.forEach(d => { if (d.data().atualizadoEm) setUltimaSync(d.data().atualizadoEm); });
    });
    return unsub;
  }, [aba]);

  const minutosDesdeSync = useMemo(() => {
    if (!ultimaSync) return null;
    return Math.floor((agora - new Date(ultimaSync).getTime()) / 60000);
  }, [ultimaSync, agora]);

  const bridgeOffline = minutosDesdeSync != null && minutosDesdeSync > MINUTOS_ATE_ALERTA;

  const listaFiltrada = useMemo(() => {
    const bruta = aba === 'saidas' ? saidas : entradas;
    if (!busca.trim()) return bruta;
    const t = busca.toLowerCase();
    return bruta.filter(m =>
      (m.produto || '').toLowerCase().includes(t) ||
      (m.codigo  || '').toLowerCase().includes(t) ||
      (m.doc     || '').toLowerCase().includes(t)
    );
  }, [saidas, entradas, aba, busca]);

  const totalQtd = useMemo(
    () => listaFiltrada.reduce((s, m) => s + (aba === 'saidas' ? (m.qtd || 0) : (m.entradaEst || 0)), 0),
    [listaFiltrada, aba]
  );

  const corAba = aba === 'entradas' ? '#15803d' : '#b91c1c';

  return (
    <div className="container">

      {ultimaSync && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
          borderRadius: 12, marginBottom: 14,
          background: bridgeOffline ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${bridgeOffline ? '#fecaca' : '#bbf7d0'}`,
          fontSize: '0.75rem', color: bridgeOffline ? '#b91c1c' : '#15803d', fontWeight: 600,
        }}>
          <i className={bridgeOffline ? 'ph ph-warning-circle' : 'ph ph-check-circle'}></i>
          {bridgeOffline
            ? <span><strong>Bridge possivelmente offline.</strong> Última sync há {minutosDesdeSync} min ({formatarDataHora(ultimaSync)}). Dados podem estar desatualizados.</span>
            : <span>Winthor sincronizado {minutosDesdeSync === 0 ? 'agora' : `há ${minutosDesdeSync} min`} ({formatarDataHora(ultimaSync)})</span>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={'btn' + (aba === 'saidas' ? ' btn-primary' : ' btn-outline')}
          onClick={() => { setAba('saidas'); setBusca(''); }}
          style={{ borderRadius: 50, padding: '8px 20px', flex: 1 }}>
          <i className="ph ph-arrow-up" style={{ marginRight: 6 }}></i>
          Saídas de hoje ({saidas.length})
        </button>
        <button className={'btn' + (aba === 'entradas' ? ' btn-primary' : ' btn-outline')}
          onClick={() => { setAba('entradas'); setBusca(''); }}
          style={{ borderRadius: 50, padding: '8px 20px', flex: 1 }}>
          <i className="ph ph-arrow-down" style={{ marginRight: 6 }}></i>
          Entradas estimadas ({entradas.length})
        </button>
      </div>

      {aba === 'entradas' && (
        <div style={{ padding: '10px 14px', borderRadius: 12, marginBottom: 14, background: '#fffbeb', border: '1px solid #fde68a', fontSize: '0.72rem', color: '#92400e' }}>
          <strong>Estimativa:</strong> entrada = estoque hoje − estoque ontem + saídas de hoje.
          Atualiza a cada ciclo da bridge. Não é um log de NF — é a variação positiva do saldo.
        </div>
      )}

      <input type="text" className="input-texto"
        placeholder={aba === 'saidas' ? 'Buscar produto, código ou documento...' : 'Buscar produto ou código...'}
        value={busca} onChange={e => setBusca(e.target.value)} style={{ marginBottom: 14 }} />

      {listaFiltrada.length > 0 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 16px', borderRadius: 12, marginBottom: 14,
          background: 'var(--amarelo-claro)', border: '1px solid var(--amarelo)',
        }}>
          <span style={{ fontWeight: 800, color: 'var(--marrom)', fontSize: '0.85rem' }}>
            {listaFiltrada.length} {aba === 'saidas' ? 'registro' : 'produto'}{listaFiltrada.length !== 1 ? 's' : ''}
            {busca.trim() && ' (filtrado)'}
          </span>
          <span style={{ fontWeight: 900, color: corAba, fontSize: '1rem' }}>
            {aba === 'entradas' ? '+' : '−'}{formatarKg(totalQtd)}
          </span>
        </div>
      )}

      {carregando && <div className="status-msg">Carregando...</div>}

      {!carregando && listaFiltrada.length === 0 && (
        <div className="status-msg">
          {busca.trim() ? 'Nenhum resultado para esta busca.'
            : aba === 'saidas'
              ? 'Nenhuma saída registrada hoje ainda. A bridge atualiza a cada 3 min.'
              : 'Nenhuma entrada estimada. Pode não ter havido recebimento, ou o histórico de ontem ainda não existe.'}
        </div>
      )}

      {aba === 'saidas' && listaFiltrada.map((m, i) => (
        <div key={i} className="card" style={{ padding: '12px 16px', marginBottom: 8, borderLeftColor: corAba }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--marrom)', fontSize: '0.9rem' }}>{m.produto || '(sem descrição)'}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--marrom-claro)', fontFamily: 'monospace', marginTop: 2 }}>
                CÓD {m.codigo}{m.doc && <> · DOC {m.doc}</>}{m.origem && <> · {m.origem}</>}
              </div>
              {m.tipo && <div style={{ fontSize: '0.68rem', color: 'var(--marrom-claro)', marginTop: 2 }}>{m.tipo}</div>}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontWeight: 900, fontSize: '1.05rem', color: corAba }}>−{formatarKg(m.qtd)}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--marrom-claro)', fontWeight: 700, textTransform: 'uppercase' }}>{m.unidade || 'UN'}</div>
            </div>
          </div>
        </div>
      ))}

      {aba === 'entradas' && listaFiltrada.map((m, i) => (
        <div key={i} className="card" style={{ padding: '12px 16px', marginBottom: 8, borderLeftColor: corAba }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--marrom)', fontSize: '0.9rem' }}>{m.produto}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--marrom-claro)', fontFamily: 'monospace', marginTop: 2 }}>CÓD {m.codigo}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--marrom-claro)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>Ontem: <strong>{formatarKg(m.estoqueOntem)}</strong></span>
                <span>Hoje: <strong>{formatarKg(m.estoqueAtual)}</strong></span>
                {m.saidaHoje > 0 && <span>Saídas: <strong>{formatarKg(m.saidaHoje)}</strong></span>}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontWeight: 900, fontSize: '1.05rem', color: corAba }}>+{formatarKg(m.entradaEst)}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--marrom-claro)', fontWeight: 700, textTransform: 'uppercase' }}>{m.unidade}</div>
              <div style={{ fontSize: '0.6rem', color: '#a78355', marginTop: 2 }}>estimado</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
