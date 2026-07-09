import { useState } from 'react';
import { collection, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useProdutos } from '../services/hooks';

export default function Produtos() {
  const { produtos, carregando } = useProdutos();
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('');
  const [salvando, setSalvando] = useState(false);
  const categoriasExistentes = Array.from(new Set(produtos.map(p => p.categoria).filter(Boolean))).sort();

  async function adicionar() {
    if (!nome.trim() || !categoria.trim()) { alert('Preencha nome e setor.'); return; }
    setSalvando(true);
    try { await addDoc(collection(db, 'produtos'), { nome: nome.trim(), categoria: categoria.trim() }); setNome(''); setCategoria(''); }
    catch (e) { alert('Erro: ' + e.message); }
    finally { setSalvando(false); }
  }

  async function remover(id) { if (!confirm('Remover este produto?')) return; await deleteDoc(doc(db, 'produtos', id)); }

  const porCategoria = {};
  produtos.forEach(p => { const cat = p.categoria || 'Sem setor'; if (!porCategoria[cat]) porCategoria[cat] = []; porCategoria[cat].push(p); });

  return (
    <div className="container">
      <div className="card">
        <div className="nome" style={{ marginBottom: 10 }}>Novo produto</div>
        <input className="input-texto" placeholder="Nome do produto (ex: Coxinha de Frango)" value={nome} onChange={e => setNome(e.target.value)} />
        <input className="input-texto" placeholder="Setor (ex: Massas, Recheios, Empanados)" value={categoria} onChange={e => setCategoria(e.target.value)} list="lista-setores" style={{ marginTop: 8 }} />
        <datalist id="lista-setores">{categoriasExistentes.map(c => <option key={c} value={c} />)}</datalist>
        <button className="btn btn-primary btn-block" disabled={salvando} onClick={adicionar} style={{ marginTop: 10 }}>{salvando ? 'Salvando...' : '+ Adicionar Produto'}</button>
      </div>
      {carregando && <div className="status-msg">Carregando produtos...</div>}
      {Object.keys(porCategoria).sort().map(cat => (
        <div key={cat}>
          <div className="cat-heading">{cat}</div>
          {porCategoria[cat].map(p => (
            <div className="card" key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="nome">{p.nome}</div>
              <button className="remover-btn" onClick={() => remover(p.id)}>✕</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
