import { useState } from 'react';
import { collection, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useProdutos } from '../services/hooks';

function FormularioProduto({ dados, categoriasExistentes, onSalvar, onCancelar, salvando }) {
  const [nome, setNome] = useState(dados?.nome || '');
  const [categoria, setCategoria] = useState(dados?.categoria || '');
  const [minPA, setMinPA] = useState(dados?.estoqueMinAcabado ?? '');
  const [maxPA, setMaxPA] = useState(dados?.estoqueMaxAcabado ?? '');
  const [minMP, setMinMP] = useState(dados?.estoqueMinMP ?? '');
  const [maxMP, setMaxMP] = useState(dados?.estoqueMaxMP ?? '');

  function salvar() {
    if (!nome.trim() || !categoria.trim()) { alert('Preencha nome e setor.'); return; }
    onSalvar({
      nome: nome.trim(),
      categoria: categoria.trim(),
      estoqueMinAcabado: parseFloat(minPA) || 0,
      estoqueMaxAcabado: parseFloat(maxPA) || 0,
      estoqueMinMP: parseFloat(minMP) || 0,
      estoqueMaxMP: parseFloat(maxMP) || 0,
    });
  }

  return (
    <>
      <input className="input-texto" placeholder="Nome do produto (ex: Coxinha de Frango)" value={nome} onChange={e => setNome(e.target.value)} autoFocus />
      <input className="input-texto" placeholder="Setor (ex: Massas, Recheios, Empanados)" value={categoria} onChange={e => setCategoria(e.target.value)} list="lista-setores" style={{ marginTop: 8 }} />
      <datalist id="lista-setores">{categoriasExistentes.map(c => <option key={c} value={c} />)}</datalist>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
        <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: 4 }}>ESTOQUE ACABADO (kg/und)</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="number" className="input-texto" placeholder="Mín" value={minPA} onChange={e => setMinPA(e.target.value)} style={{ padding: 8 }} />
            <input type="number" className="input-texto" placeholder="Máx" value={maxPA} onChange={e => setMaxPA(e.target.value)} style={{ padding: 8 }} />
          </div>
        </div>
        <div style={{ background: '#fff7ed', padding: 10, borderRadius: 8, border: '1px solid #ffedd5' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ea580c', marginBottom: 4 }}>MATÉRIA PRIMA (kg/und)</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="number" className="input-texto" placeholder="Mín" value={minMP} onChange={e => setMinMP(e.target.value)} style={{ padding: 8 }} />
            <input type="number" className="input-texto" placeholder="Máx" value={maxMP} onChange={e => setMaxMP(e.target.value)} style={{ padding: 8 }} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        {onCancelar && <button className="btn btn-outline btn-block" onClick={onCancelar}>Cancelar</button>}
        <button className="btn btn-primary btn-block" disabled={salvando} onClick={salvar}>
          {salvando ? 'Salvando...' : (dados ? 'Salvar Alterações' : '+ Adicionar Produto')}
        </button>
      </div>
    </>
  );
}

// ── Modal de edição — abre por cima da tela, não depende de scroll ──
function ModalEditarProduto({ produto, categoriasExistentes, onSalvar, onFechar, salvando }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onFechar}>
      <div style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', padding: 22 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="nome" style={{ fontWeight: 900, fontSize: '1.1rem' }}>Editar produto</div>
          <button onClick={onFechar} style={{ background: 'none', border: 'none', fontSize: '1.4rem', color: '#999', cursor: 'pointer' }}>✕</button>
        </div>
        <FormularioProduto
          dados={produto}
          categoriasExistentes={categoriasExistentes}
          onSalvar={onSalvar}
          onCancelar={onFechar}
          salvando={salvando}
        />
      </div>
    </div>
  );
}

export default function Produtos() {
  const { produtos, carregando } = useProdutos();
  const [salvando, setSalvando] = useState(false);
  const [produtoEditando, setProdutoEditando] = useState(null); // null = fechado, {} = novo, {...} = editando

  const categoriasExistentes = Array.from(new Set(produtos.map(p => p.categoria).filter(Boolean))).sort();

  async function salvarProduto(payload) {
    setSalvando(true);
    try {
      if (produtoEditando?.id) {
        await updateDoc(doc(db, 'produtos', produtoEditando.id), payload);
      } else {
        await addDoc(collection(db, 'produtos'), payload);
      }
      setProdutoEditando(null);
    } catch (e) {
      console.error('Erro ao salvar produto:', e);
      alert(`Erro ao salvar (${e.code || 'desconhecido'}): ${e.message}\n\nSe mencionar "permission" ou "insufficient", as regras do Firestore precisam liberar update na coleção "produtos".`);
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id) {
    if (!confirm('Remover este produto?')) return;
    try {
      await deleteDoc(doc(db, 'produtos', id));
    } catch (e) {
      alert(`Erro ao remover (${e.code || 'desconhecido'}): ${e.message}`);
    }
  }

  const porCategoria = {};
  produtos.forEach(p => { const cat = p.categoria || 'Sem setor'; if (!porCategoria[cat]) porCategoria[cat] = []; porCategoria[cat].push(p); });

  return (
    <div className="container">
      {/* Botão fixo para adicionar novo — abre o mesmo modal, sem dados */}
      <button className="btn btn-primary btn-block" onClick={() => setProdutoEditando({})} style={{ marginBottom: 16 }}>
        + Adicionar Produto
      </button>

      {carregando && <div className="status-msg">Carregando produtos...</div>}

      {Object.keys(porCategoria).sort().map(cat => (
        <div key={cat}>
          <div className="cat-heading">{cat}</div>
          {porCategoria[cat].map(p => (
            <div className="card" key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="nome">{p.nome}</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                  PA: {p.estoqueMinAcabado || 0}-{p.estoqueMaxAcabado || 0} | MP: {p.estoqueMinMP || 0}-{p.estoqueMaxMP || 0}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  className="btn btn-outline"
                  style={{ padding: '4px 10px', fontSize: '0.75rem', marginRight: 8 }}
                  onClick={() => setProdutoEditando(p)}
                >
                  Editar
                </button>
                <button className="remover-btn" onClick={() => remover(p.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {produtoEditando && (
        <ModalEditarProduto
          produto={produtoEditando.id ? produtoEditando : null}
          categoriasExistentes={categoriasExistentes}
          onSalvar={salvarProduto}
          onFechar={() => setProdutoEditando(null)}
          salvando={salvando}
        />
      )}
    </div>
  );
}
