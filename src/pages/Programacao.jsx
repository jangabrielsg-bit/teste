import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, orderBy, where, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { formatarDataBR, formatarKg } from '../services/utils';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEMANA = ['D','S','T','Q','Q','S','S'];

function chaveMes(ano, mes) { return `${ano}-${String(mes + 1).padStart(2, '0')}`; }
function isoDia(ano, mes, dia) { return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`; }

export default function Programacao() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth());
  const [diaSelecionado, setDiaSelecionado] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');

  // Cache por mês: { 'YYYY-MM': { 'YYYY-MM-DD': { categorias: {...}, atualizadoEm } } }
  const cacheRef = useRef({});
  const [, forcarRender] = useState(0);

  const chave = chaveMes(ano, mes);

  useEffect(() => {
    let ativo = true;
    (async () => {
      if (cacheRef.current[chave]) { setCarregando(false); return; }
      setCarregando(true);
      try {
        const inicio = isoDia(ano, mes, 1);
        const ultimoDia = new Date(ano, mes + 1, 0).getDate();
        const fim = isoDia(ano, mes, ultimoDia);
        const q = query(
          collection(db, 'winthorSugestoes'),
          where('data', '>=', inicio),
          where('data', '<=', fim),
          orderBy('data', 'asc')
        );
        const snap = await getDocs(q);
        const doMes = {};
        snap.forEach(d => {
          const dados = d.data();
          doMes[dados.data] = { categorias: dados.categorias || {}, atualizadoEm: dados.atualizadoEm };
        });
        if (ativo) { cacheRef.current[chave] = doMes; forcarRender(n => n + 1); }
      } catch (e) {
        console.error('Erro ao carregar programação do mês:', e);
        if (ativo) cacheRef.current[chave] = {};
      }
      if (ativo) setCarregando(false);
    })();
    return () => { ativo = false; };
  }, [chave, ano, mes]);

  const dadosMes = cacheRef.current[chave] || {};
  const diasComDados = useMemo(() => new Set(Object.keys(dadosMes).map(d => parseInt(d.slice(8), 10))), [dadosMes]);

  const grade = useMemo(() => {
    const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
    const totalDias = new Date(ano, mes + 1, 0).getDate();
    const celulas = [];
    for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
    for (let d = 1; d <= totalDias; d++) celulas.push(d);
    return celulas;
  }, [ano, mes]);

  function navegarMes(delta) {
    let novoMes = mes + delta, novoAno = ano;
    if (novoMes < 0) { novoMes = 11; novoAno--; }
    if (novoMes > 11) { novoMes = 0; novoAno++; }
    setMes(novoMes); setAno(novoAno);
    setDiaSelecionado(null);
    setBusca('');
  }

  function selecionarDia(dia) {
    if (!dia) return;
    const iso = isoDia(ano, mes, dia);
    setDiaSelecionado(prev => prev === iso ? null : iso);
    setBusca('');
  }

  // Resumo do mês
  const resumoMes = useMemo(() => {
    let receitas = 0, produtos = 0, dias = 0;
    Object.values(dadosMes).forEach(({ categorias }) => {
      dias++;
      Object.values(categorias).forEach(lista => {
        lista.forEach(item => { receitas += item.metaLotes || 0; produtos++; });
      });
    });
    return { receitas, produtos, dias };
  }, [dadosMes]);

  const ehHoje = (dia) => dia && ano === hoje.getFullYear() && mes === hoje.getMonth() && dia === hoje.getDate();
  const ehSelecionado = (dia) => dia && diaSelecionado === isoDia(ano, mes, dia);

  // Dados a exibir: dia selecionado, ou o mês inteiro
  const categoriasParaExibir = diaSelecionado ? (dadosMes[diaSelecionado]?.categorias || {}) : null;

  function filtrarCategorias(categorias) {
    if (!busca.trim()) return categorias;
    const t = busca.toLowerCase();
    const filtradas = {};
    Object.entries(categorias).forEach(([cat, itens]) => {
      const match = itens.filter(it => (it.produto || '').toLowerCase().includes(t) || (it.codigo || '').toLowerCase().includes(t));
      if (match.length > 0) filtradas[cat] = match;
    });
    return filtradas;
  }

  return (
    <div className="container">

      {/* ── Calendário ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--border-suave)' }}>
          <button onClick={() => navegarMes(-1)} style={{ background: 'none', border: '1px solid var(--border-forte)', borderRadius: 10, width: 36, height: 36, cursor: 'pointer', color: 'var(--marrom)', fontSize: '1rem' }}>
            <i className="ph ph-caret-left"></i>
          </button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--marrom)' }}>{MESES[mes]} {ano}</div>
            {!carregando && resumoMes.dias > 0 && (
              <div style={{ fontSize: '0.72rem', color: 'var(--marrom-claro)', fontWeight: 600, marginTop: 1 }}>
                {resumoMes.dias} dia{resumoMes.dias > 1 ? 's' : ''} programado{resumoMes.dias > 1 ? 's' : ''} · {resumoMes.receitas} receitas sugeridas
              </div>
            )}
          </div>
          <button onClick={() => navegarMes(1)} style={{ background: 'none', border: '1px solid var(--border-forte)', borderRadius: 10, width: 36, height: 36, cursor: 'pointer', color: 'var(--marrom)', fontSize: '1rem' }}>
            <i className="ph ph-caret-right"></i>
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '10px 12px 4px' }}>
          {DIAS_SEMANA.map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 800, color: 'var(--marrom-claro)', textTransform: 'uppercase' }}>{d}</div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, padding: '4px 12px 14px' }}>
          {grade.map((dia, i) => {
            if (!dia) return <div key={i} />;
            const temDados = diasComDados.has(dia);
            const selecionado = ehSelecionado(dia);
            const hojeFlag = ehHoje(dia);
            return (
              <button
                key={i}
                onClick={() => selecionarDia(dia)}
                disabled={!temDados}
                style={{
                  aspectRatio: '1',
                  border: selecionado ? '2px solid var(--amarelo-escuro)' : hojeFlag ? '1px dashed var(--amarelo-escuro)' : '1px solid transparent',
                  borderRadius: 10,
                  background: selecionado ? 'var(--amarelo)' : temDados ? 'var(--amarelo-claro)' : 'transparent',
                  color: temDados ? 'var(--marrom)' : '#cfc4ad',
                  fontWeight: selecionado || hojeFlag ? 900 : temDados ? 700 : 500,
                  fontSize: '0.88rem',
                  cursor: temDados ? 'pointer' : 'default',
                  position: 'relative',
                  transition: 'all 0.12s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {dia}
                {temDados && !selecionado && (
                  <span style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', width: 5, height: 5, borderRadius: '50%', background: 'var(--amarelo-escuro)' }} />
                )}
              </button>
            );
          })}
        </div>

        {carregando && <div className="status-msg" style={{ padding: '14px 0' }}>Carregando mês...</div>}
      </div>

      {/* ── Busca ── */}
      <input
        type="text"
        className="input-texto"
        placeholder="Buscar produto ou código..."
        value={busca}
        onChange={e => setBusca(e.target.value)}
        style={{ marginBottom: 16 }}
      />

      {/* ── Dia selecionado ── */}
      {diaSelecionado && !carregando && (
        <>
          <div className="cat-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 4 }}>
            <span>{formatarDataBR(diaSelecionado)}</span>
            <button onClick={() => setDiaSelecionado(null)} style={{ background: 'none', border: 'none', color: 'var(--amarelo-escuro)', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
              ver mês inteiro →
            </button>
          </div>
          <BlocoCategorias categorias={filtrarCategorias(categoriasParaExibir)} />
        </>
      )}

      {/* ── Mês inteiro, dia a dia ── */}
      {!diaSelecionado && !carregando && (
        Object.keys(dadosMes).length === 0
          ? <div className="status-msg">Nenhuma OP do Winthor programada neste mês.<br />Use as setas para navegar entre meses.</div>
          : Object.entries(dadosMes)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([data, { categorias }]) => {
                const filtradas = filtrarCategorias(categorias);
                if (busca.trim() && Object.keys(filtradas).length === 0) return null;
                return (
                  <div key={data}>
                    <div className="cat-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 4 }}>
                      <span>{formatarDataBR(data)}</span>
                      <button onClick={() => setDiaSelecionado(data)} style={{ background: 'none', border: 'none', color: 'var(--amarelo-escuro)', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                        ver só este dia →
                      </button>
                    </div>
                    <BlocoCategorias categorias={filtradas} />
                  </div>
                );
              })
      )}
    </div>
  );
}

// ── Bloco reutilizável: lista de categorias/produtos de um dia ────
function BlocoCategorias({ categorias }) {
  const nomesCategorias = Object.keys(categorias || {}).sort();
  if (nomesCategorias.length === 0) {
    return <div className="status-msg" style={{ padding: '16px 0' }}>Nenhum item encontrado.</div>;
  }
  return (
    <>
      {nomesCategorias.map(cat => (
        <div key={cat} className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ padding: '12px 16px', background: 'var(--amarelo-claro)', fontWeight: 800, fontSize: '0.85rem', color: 'var(--marrom)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><i className="ph ph-tag" style={{ marginRight: 6 }}></i>{cat}</span>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--marrom-claro)' }}>{categorias[cat].length} produto{categorias[cat].length > 1 ? 's' : ''}</span>
          </div>
          {categorias[cat].map((item, idx) => (
            <div key={idx} style={{ padding: '12px 16px', borderTop: '1px solid var(--border-suave)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--marrom)', fontSize: '0.92rem' }}>{item.produto}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--marrom-claro)', fontFamily: 'monospace', marginTop: 2 }}>
                  CÓD: {item.codigo}{item.ops?.length > 0 && <> · OP: {item.ops.join(', ')}</>}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                <div style={{ fontWeight: 900, fontSize: '1rem', color: 'var(--marrom)' }}>{item.metaLotes}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--marrom-claro)', fontWeight: 700, textTransform: 'uppercase' }}>receita{item.metaLotes > 1 ? 's' : ''}</div>
                {item.rendimentoTeorico > 0 && (
                  <div style={{ fontSize: '0.68rem', color: 'var(--marrom-claro)', marginTop: 2 }}>{formatarKg(item.rendimentoTeorico)} kg</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
