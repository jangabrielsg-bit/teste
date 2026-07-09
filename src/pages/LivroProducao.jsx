import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { formatarDataBR, formatarKg } from '../services/utils';

export default function LivroProducao() {
  const [carregando, setCarregando] = useState(true);
  const [linhas, setLinhas] = useState([]);

  useEffect(() => {
    (async () => {
      const q = query(collection(db, 'producaoDiaria'), orderBy('data', 'desc'), limit(60));
      const snap = await getDocs(q);
      const todas = [];
      snap.forEach(d => {
        const data = d.data();
        (data.itens || []).forEach(it => {
          todas.push({ data: data.data, ordem: (it.ordem != null ? it.ordem : 0) + 1, codigo: it.codigo, produto: it.produto, categoria: it.categoria, metaLotes: it.metaLotes, feitos: it.feitos, ops: it.ops || [], massaPerdidaProd: it.massaPerdidaProd || 0, massaPerdidaEmb: it.massaPerdidaEmb || 0, peDeMassa: it.peDeMassa || 0, finalizado: !!it.finalizado });
        });
      });
      setLinhas(todas);
      setCarregando(false);
    })();
  }, []);

  async function exportarExcel() {
    try {
      const XLSX = await import('xlsx');
      const dadosPlanilha = linhas.map(l => ({
        'Data': formatarDataBR(l.data), 'Ordem': l.ordem, 'Código': l.codigo, 'OPs Winthor': (l.ops || []).join(', '),
        'Produto': l.produto, 'Setor': l.categoria, 'Receitas Programadas': l.metaLotes, 'Receitas Realizadas': l.feitos,
        'Massa Perdida Produção (kg)': l.massaPerdidaProd, 'Massa Perdida Embalagem (kg)': l.massaPerdidaEmb,
        'Pé de Massa (kg)': l.peDeMassa, 'Fechamento': l.finalizado ? 'Sim' : 'Não'
      }));
      const ws = XLSX.utils.json_to_sheet(dadosPlanilha);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Livro de Produção');
      XLSX.writeFile(wb, 'livro_producao_imac.xlsx');
    } catch (e) { alert('Erro ao exportar: ' + e.message); }
  }

  if (carregando) return <div className="status-msg">Carregando histórico...</div>;
  if (linhas.length === 0) return <div className="status-msg">Nenhum registro de produção encontrado.</div>;

  let dataAnterior = null;
  return (
    <div className="container">
      <button className="btn btn-primary btn-block" onClick={exportarExcel} style={{ marginBottom: 16 }}>Exportar Excel</button>
      {linhas.map((l, idx) => {
        const mostrar = l.data !== dataAnterior;
        dataAnterior = l.data;
        return (
          <div key={idx}>
            {mostrar && <div className="cat-heading">{formatarDataBR(l.data)}</div>}
            <div className="card">
              <div className="card-top"><div className="nome">{l.ordem}. {l.produto}</div>{l.finalizado && <span className="selo-ok">Fechado</span>}</div>
              <div className="livro-linha">Setor: {l.categoria}</div>
              <div className="livro-linha">Programadas: {l.metaLotes} · Realizadas: {l.feitos}</div>
              <div className="livro-linha">Perda produção: {formatarKg(l.massaPerdidaProd)} kg · Perda embalagem: {formatarKg(l.massaPerdidaEmb)} kg</div>
              {l.peDeMassa > 0 && <div className="livro-linha">Pé de massa: {formatarKg(l.peDeMassa)} kg</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
