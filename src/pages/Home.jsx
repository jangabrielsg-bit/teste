import { useAuth } from '../services/auth';

const MENU_ITEMS = [
  { id: 'programacao', label: 'Programação', icon: 'ph-calendar-check', bg: '#eef2ff', color: '#4338ca', perfis: ['pcp','lider','expedicao'] },
  { id: 'lider', label: 'Conferência de Receitas', icon: 'ph-users', bg: '#fff3d6', color: '#d99d0b', perfis: ['lider','pcp'] },
  { id: 'operador', label: 'Produção', icon: 'ph-cooking-pot', bg: '#fff7ed', color: '#ea580c', perfis: ['lider','producao','pcp'] },
  { id: 'embaladora', label: 'Embaladora', icon: 'ph-package', bg: '#fdf2f8', color: '#db2777', perfis: ['embaladora','pcp'] },
  { id: 'fechamento', label: 'Fechamento', icon: 'ph-check-circle', bg: '#f0fdf4', color: '#16a34a', perfis: ['lider','pcp'] },
  { id: 'livro', label: 'Livro de Produção', icon: 'ph-book-open', bg: '#faf5ff', color: '#9333ea', perfis: ['lider','pcp'] },
  { id: 'produtos', label: 'Produtos', icon: 'ph-package', bg: '#fefce8', color: '#ca8a04', perfis: ['pcp'] },
  { id: 'pcp', label: 'Lançamentos PCP', icon: 'ph-chart-bar', bg: '#ecfeff', color: '#0891b2', perfis: ['pcp'] },
  { id: 'resumo_pcp', label: 'Painel TV (Resumos)', icon: 'ph-monitor-play', bg: '#eef2ff', color: '#4f46e5', perfis: ['pcp'] },
  { id: 'expedicao', label: 'Expedição Balança', icon: 'ph-scales', bg: '#fff1f2', color: '#e11d48', perfis: ['expedicao','pcp'] },
  { id: 'estoque', label: 'Gestão de Estoques', icon: 'ph-snowflake', bg: '#f0f9ff', color: '#0284c7', perfis: ['expedicao','pcp','lider'] },
];

export default function Home({ ir }) {
  const { currentUser } = useAuth();
  const s = currentUser?.setor;

  const itensVisiveis = MENU_ITEMS.filter(item => item.perfis.includes(s));

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <img src={import.meta.env.BASE_URL + 'logo.png'} alt="IMAC" style={{ height: 60, marginBottom: 12 }} />
        <h1 style={{ fontWeight: 900, fontSize: '1.4rem', color: 'var(--marrom)' }}>Fábrica / PCP</h1>
      </div>
      <div className="menu-grid">
        {itensVisiveis.map(item => (
          <button key={item.id} className="menu-card" onClick={() => ir(item.id)}>
            <div className="icon-circle" style={{ background: item.bg, color: item.color }}>
              <i className={`ph ${item.icon}`}></i>
            </div>
            <span className="label">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
