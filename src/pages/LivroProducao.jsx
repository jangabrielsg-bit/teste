import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, orderBy, where, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { formatarDataBR, formatarKg } from '../services/utils';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEMANA = ['D','S','T','Q','Q','S','S'];

function chaveMes(ano, mes) { return `${ano}-${String(mes + 1).padStart(2, '0')}`; }
function isoDia(ano, mes, dia) { return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`; }

// ── Agrega o consumo de matéria-prima (todas as batidas) por insumo ──
function agregarConsumoMP(consumoMP) {
  if (!consumoMP || consumoMP.length === 0) return [];
  const porInsumo = {};
  consumoMP.forEach(evento => {
    (evento.consumos || []).forEach(c => {
      if (!porInsumo[c.nomeMP]) porInsumo[c.nomeMP] = { nomeMP: c.nomeMP, unidade: c.unidade, total: 0, lotes: {} };
      porInsumo[c.nomeMP].total += c.atendido || 0;
      (c.lotes || []).forEach(l => {
        const chaveLote = l.loteNumero || l.loteId;
        if (!porInsumo[c.nomeMP].lotes[chaveLote]) porInsumo[c.nomeMP].lotes[chaveLote] = { loteNumero: chaveLote, validade: l.validade, qtd: 0 };
        porInsumo[c.nomeMP].lotes[chaveLote].qtd += l.quantidade || 0;
      });
    });
  });
  return Object.values(porInsumo).map(ins => ({ ...ins, lotes: Object.values(ins.lotes) }));
}

// ── Bloco visual: rastreabilidade de matéria-prima de um item ──────
function RastreabilidadeMP({ consumoMP }) {
  const agregado = agregarConsumoMP(consumoMP);
  if (agregado.length === 0) return null;
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border-suave)' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--marrom-claro)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
        <i className="ph ph-package-check" style={{ marginRight: 4 }}></i>Matéria-prima consumida (FEFO)
      </div>
      {agregado.map((ins, i) => (
        <div key={i} style={{ fontSize: '0.75rem', color: 'var(--marrom)', marginBottom: 2 }}>
          <strong>{ins.nomeMP}</strong>: {formatarKg(ins.total)} {ins.unidade}
          {ins.lotes.length > 0 && (
            <span style={{ color: 'var(--marrom-claro)' }}>
              {' '}({ins.lotes.map(l => `Lote ${l.loteNumero}${l.validade ? ` · val. ${l.validade}` : ''}: ${formatarKg(l.qtd)}`).join(' | ')})
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function LivroProducao() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth());
  const [diaSelecionado, setDiaSelecionado] = useState(null); // 'YYYY-MM-DD'
  const [carregando, setCarregando] = useState(true);

  // Cache por mês: { 'YYYY-MM': { 'YYYY-MM-DD': [itens...] } }
  const cacheRef = useRef({});
  const [, forcarRender] = useState(0);

  const chave = chaveMes(ano, mes);

  // Carrega o mês (uma query, só se não estiver em cache)
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
          collection(db, 'producaoDiaria'),
          where('data', '>=', inicio),
          where('data', '<=', fim),
          orderBy('data', 'desc')
        );
        const snap = await getDocs(q);
        const doMes = {};
        snap.forEach(d => {
          const data = d.data();
          const itens = (data.itens || []).map(it => ({
            ordem: (it.ordem != null ? it.ordem : 0) + 1,
            codigo: it.codigo,
            produto: it.produto,
            categoria: it.categoria,
            metaLotes: it.metaLotes,
            feitos: it.feitos,
            ops: it.ops || [],
            massaPerdidaProd: it.massaPerdidaProd || 0,
            massaPerdidaEmb: it.massaPerdidaEmb || 0,
            peDeMassa: it.peDeMassa || 0,
            finalizado: !!it.finalizado,
            consumoMP: it.consumoMP || [],
          }));
          if (itens.length > 0) doMes[data.data] = itens;
        });
        if (ativo) {
          cacheRef.current[chave] = doMes;
          forcarRender(n => n + 1);
        }
      } catch (e) {
        console.error('Erro ao carregar mês:', e);
        if (ativo) cacheRef.current[chave] = {};
      }
      if (ativo) setCarregando(false);
    })();
    return () => { ativo = false; };
  }, [chave, ano, mes]);

  const dadosMes = cacheRef.current[chave] || {};
  const diasComDados = useMemo(() => new Set(Object.keys(dadosMes).map(d => parseInt(d.slice(8), 10))), [dadosMes]);

  // Grade do calendário
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
  }

  function selecionarDia(dia) {
    if (!dia) return;
    const iso = isoDia(ano, mes, dia);
    setDiaSelecionado(prev => prev === iso ? null : iso);
  }

  // Resumo do mês
  const resumoMes = useMemo(() => {
    let receitas = 0, dias = 0, perdas = 0;
    Object.values(dadosMes).forEach(itens => {
      dias++;
      itens.forEach(it => {
        receitas += it.feitos || 0;
        perdas += (it.massaPerdidaProd || 0) + (it.massaPerdidaEmb || 0);
      });
    });
    return { receitas, dias, perdas };
  }, [dadosMes]);

  const itensDoDia = diaSelecionado ? (dadosMes[diaSelecionado] || []) : null;

  async function exportarExcel() {
    try {
      const XLSX = await import('xlsx');
      const linhas = [];
      Object.entries(dadosMes)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([data, itens]) => {
          itens.forEach(it => {
            linhas.push({
              'Data': formatarDataBR(data), 'Ordem': it.ordem, 'Código': it.codigo,
              'OPs Winthor': (it.ops || []).join(', '), 'Produto': it.produto, 'Setor': it.categoria,
              'Receitas Programadas': it.metaLotes, 'Receitas Realizadas': it.feitos,
              'Massa Perdida Produção (kg)': it.massaPerdidaProd, 'Massa Perdida Embalagem (kg)': it.massaPerdidaEmb,
              'Pé de Massa (kg)': it.peDeMassa, 'Fechamento': it.finalizado ? 'Sim' : 'Não',
            });
          });
        });
      if (linhas.length === 0) { alert('Nenhum dado neste mês para exportar.'); return; }
      const ws = XLSX.utils.json_to_sheet(linhas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Livro de Produção');
      XLSX.writeFile(wb, `livro_producao_${chave}.xlsx`);
    } catch (e) { alert('Erro ao exportar: ' + e.message); }
  }

  const ehHoje = (dia) => dia && ano === hoje.getFullYear() && mes === hoje.getMonth() && dia === hoje.getDate();
  const ehSelecionado = (dia) => dia && diaSelecionado === isoDia(ano, mes, dia);

  return (
    <div className="container">

      {/* ── Calendário ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Navegação do mês */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--border-suave)' }}>
          <button onClick={() => navegarMes(-1)} style={{ background: 'none', border: '1px solid var(--border-forte)', borderRadius: 10, width: 36, height: 36, cursor: 'pointer', color: 'var(--marrom)', fontSize: '1rem' }}>
            <i className="ph ph-caret-left"></i>
          </button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--marrom)' }}>{MESES[mes]} {ano}</div>
            {!carregando && resumoMes.dias > 0 && (
              <div style={{ fontSize: '0.72rem', color: 'var(--marrom-claro)', fontWeight: 600, marginTop: 1 }}>
                {resumoMes.dias} dia{resumoMes.dias > 1 ? 's' : ''} · {resumoMes.receitas} receitas · {formatarKg(resumoMes.perdas)} kg perdas
              </div>
            )}
          </div>
          <button onClick={() => navegarMes(1)} style={{ background: 'none', border: '1px solid var(--border-forte)', borderRadius: 10, width: 36, height: 36, cursor: 'pointer', color: 'var(--marrom)', fontSize: '1rem' }}>
            <i className="ph ph-caret-right"></i>
          </button>
        </div>

        {/* Dias da semana */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '10px 12px 4px' }}>
          {DIAS_SEMANA.map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 800, color: 'var(--marrom-claro)', textTransform: 'uppercase' }}>{d}</div>
          ))}
        </div>

        {/* Grade de dias */}
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

      {/* ── Exportar ── */}
      <button className="btn btn-outline btn-block" onClick={exportarExcel} style={{ marginBottom: 16 }}>
        <i className="ph ph-file-xls" style={{ marginRight: 8 }}></i>Exportar {MESES[mes]} para Excel
      </button>

      {/* ── Detalhe do dia selecionado ── */}
      {diaSelecionado && itensDoDia && (
        <>
          <div className="cat-heading">{formatarDataBR(diaSelecionado)} — {itensDoDia.length} receita{itensDoDia.length > 1 ? 's' : ''}</div>
          {itensDoDia.map((l, idx) => (
            <div key={idx} className="card">
              <div className="card-top">
                <div className="nome">{l.ordem}. {l.produto}</div>
                {l.finalizado && <span className="selo-ok">Fechado</span>}
              </div>
              <div className="livro-linha">Setor: {l.categoria}{l.ops.length > 0 && <> · OPs: {l.ops.join(', ')}</>}</div>
              <div className="livro-linha">Programadas: {l.metaLotes} · Realizadas: {l.feitos}</div>
              <div className="livro-linha">Perda produção: {formatarKg(l.massaPerdidaProd)} kg · Perda embalagem: {formatarKg(l.massaPerdidaEmb)} kg</div>
              {l.peDeMassa > 0 && <div className="livro-linha">Pé de massa: {formatarKg(l.peDeMassa)} kg</div>}
              <RastreabilidadeMP consumoMP={l.consumoMP} />
            </div>
          ))}
        </>
      )}

      {/* ── Sem dia selecionado: lista do mês em ordem decrescente ── */}
      {!diaSelecionado && !carregando && (
        Object.keys(dadosMes).length === 0
          ? <div className="status-msg">Nenhum registro de produção neste mês.<br />Use as setas para navegar entre meses.</div>
          : <>
              {Object.entries(dadosMes)
                .sort(([a], [b]) => b.localeCompare(a))
                .map(([data, itens]) => (
                  <div key={data}>
                    <div className="cat-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 4 }}>
                      <span>{formatarDataBR(data)}</span>
                      <button
                        onClick={() => setDiaSelecionado(data)}
                        style={{ background: 'none', border: 'none', color: 'var(--amarelo-escuro)', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}
                      >
                        ver só este dia →
                      </button>
                    </div>
                    {itens.map((l, idx) => (
                      <div key={idx} className="card">
                        <div className="card-top">
                          <div className="nome">{l.ordem}. {l.produto}</div>
                          {l.finalizado && <span className="selo-ok">Fechado</span>}
                        </div>
                        <div className="livro-linha">Setor: {l.categoria}{l.ops.length > 0 && <> · OPs: {l.ops.join(', ')}</>}</div>
                        <div className="livro-linha">Programadas: {l.metaLotes} · Realizadas: {l.feitos}</div>
                        <div className="livro-linha">Perda produção: {formatarKg(l.massaPerdidaProd)} kg · Perda embalagem: {formatarKg(l.massaPerdidaEmb)} kg</div>
                        {l.peDeMassa > 0 && <div className="livro-linha">Pé de massa: {formatarKg(l.peDeMassa)} kg</div>}
                        <RastreabilidadeMP consumoMP={l.consumoMP} />
                      </div>
                    ))}
                  </div>
                ))
              }
            </>
      )}
    </div>
  );
}
