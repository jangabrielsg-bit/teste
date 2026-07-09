import { useState } from 'react';
import { collection, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useProdutos } from '../services/hooks';

export default function Produtos() {
  const { produtos, carregando } = useProdutos();
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [minPA, setMinPA] = useState('');
  const [maxPA, setMaxPA] = useState('');
  const [minMP, setMinMP] = useState('');
  const [maxMP, setMaxMP] = useState('');
  const [editandoId, setEditandoId] = useState(null);
  const categoriasExistentes = Array.from(new Set(produtos.map(p => p.categoria).filter(Boolean))).sort();

  async function adicionar() {
    if (!nome.trim() || !categoria.trim()) { alert('Preencha nome e setor.'); return; }
    setSalvando(true);
    try { 
      const payload = {
        nome: nome.trim(), 
        categoria: categoria.trim(),
        estoqueMinAcabado: parseFloat(minPA) || 0,
        estoqueMaxAcabado: parseFloat(maxPA) || 0,
        estoqueMinMP: parseFloat(minMP) || 0,
        estoqueMaxMP: parseFloat(maxMP) || 0
      };
      if (editandoId) {
        await updateDoc(doc(db, 'produtos', editandoId), payload);
      } else {
        await addDoc(collection(db, 'produtos'), payload);
      }
      setNome(''); setCategoria(''); setMinPA(''); setMaxPA(''); setMinMP(''); setMaxMP(''); setEditandoId(null);
    }
    catch (e) { alert('Erro: ' + e.message); }
    finally { setSalvando(false); }
  }

  function cancelarEdicao() {
    setNome(''); setCategoria(''); setMinPA(''); setMaxPA(''); setMinMP(''); setMaxMP(''); setEditandoId(null);
  }

  async function remover(id) { if (!confirm('Remover este produto?')) return; await deleteDoc(doc(db, 'produtos', id)); }

  const porCategoria = {};
  produtos.forEach(p => { const cat = p.categoria || 'Sem setor'; if (!porCategoria[cat]) porCategoria[cat] = []; porCategoria[cat].push(p); });

  return (
    <div className="container">
      <div className="card">
        <div className="nome" style={{ marginBottom: 10 }}>{editandoId ? 'Editar produto' : 'Novo produto'}</div>
        <input className="input-texto" placeholder="Nome do produto (ex: Coxinha de Frango)" value={nome} onChange={e => setNome(e.target.value)} />
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

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          {editandoId && <button className="btn btn-outline btn-block" onClick={cancelarEdicao}>Cancelar</button>}
          <button className="btn btn-primary btn-block" disabled={salvando} onClick={adicionar}>{salvando ? 'Salvando...' : (editandoId ? 'Salvar Alterações' : '+ Adicionar Produto')}</button>
        </div>
      </div>
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
                <button className="btn btn-outline" style={{ padding: '4px 10px', fontSize: '0.75rem', marginRight: 8 }} onClick={() => {
                  setNome(p.nome); setCategoria(p.categoria || '');
                  setMinPA(p.estoqueMinAcabado || ''); setMaxPA(p.estoqueMaxAcabado || '');
                  setMinMP(p.estoqueMinMP || ''); setMaxMP(p.estoqueMaxMP || '');
                  setEditandoId(p.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}>Editar</button>
                <button className="remover-btn" onClick={() => remover(p.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
