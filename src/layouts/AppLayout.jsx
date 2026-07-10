import { useState } from 'react';
import { useAuth } from '../services/auth';
import GlobalTicker from '../components/GlobalTicker';
import AlertasSistema from '../components/AlertasSistema';
import Home from '../pages/Home';
import Lider from '../pages/Lider';
import Operador from '../pages/Operador';
import Embaladora from '../pages/Embaladora';
import Expedicao from '../pages/Expedicao';
import Estoque from '../pages/Estoque';
import Fechamento from '../pages/Fechamento';
import LivroProducao from '../pages/LivroProducao';
import Produtos from '../pages/Produtos';
import PCP from '../pages/PCP';
import PainelTV from '../pages/PainelTV';
import ResumoPCP from '../pages/ResumoPCP';

const nomesTelas = {
  'lider': 'Conferência de Receitas',
  'operador': 'Painel de Produção',
  'embaladora': 'Embaladora',
  'resumo_pcp': 'Painel TV (Resumos)',
  'fechamento': 'Fechamento de Produção',
  'livro': 'Livro de Produção',
  'produtos': 'Produtos e Setores',
  'pcp': 'Lançamentos PCP Winthor',
  'expedicao': 'Expedição / Balança',
  'estoque': 'Gestão de Estoques'
};

export default function AppLayout() {
  const { currentUser, logout } = useAuth();
  const s = currentUser?.setor;
  const isPcp = s === 'pcp';

  const [tela, setTela] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('tv') === '1' ? 'painel' : 'inicio';
    } catch { return 'inicio'; }
  });

  if (tela === 'painel') return <PainelTV sair={() => setTela('inicio')} />;
  if (tela === 'resumo_pcp') return <ResumoPCP sair={() => setTela('inicio')} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', position: 'relative', paddingBottom: 64, background: 'var(--bg)' }}>
      <GlobalTicker />

      {/* Header */}
      <header className="app-header">
        <div className="logo-area">
          {tela !== 'inicio' && (
            <button onClick={() => setTela('inicio')} style={{ background: 'none', border: 'none', color: 'var(--marrom-claro)', cursor: 'pointer', fontSize: '1.4rem', marginRight: 4 }}>
              <i className="ph ph-arrow-left"></i>
            </button>
          )}
          <img src={import.meta.env.BASE_URL + 'logo.png'} alt="IMAC" />
          <h2>{tela === 'inicio' ? 'Fábrica / PCP' : (nomesTelas[tela] || 'Painel')}</h2>
        </div>
        <div className="user-area">
          {isPcp && <AlertasSistema />}
          <span style={{ fontWeight: 700, color: 'var(--marrom)', textTransform: 'capitalize' }}>{s}</span>
          <button onClick={logout}><i className="ph ph-sign-out" style={{ fontSize: '1.3rem' }}></i>Sair</button>
        </div>
      </header>

      {/* Main Content */}
      <main className="app-main">
        {tela === 'inicio' && <Home ir={setTela} />}
        {tela === 'lider' && <Lider />}
        {tela === 'operador' && <Operador />}
        {tela === 'embaladora' && <Embaladora />}
        {tela === 'expedicao' && <Expedicao />}
        {tela === 'estoque' && <Estoque />}
        {tela === 'fechamento' && <Fechamento />}
        {tela === 'livro' && <LivroProducao />}
        {tela === 'produtos' && <Produtos />}
        {tela === 'pcp' && <PCP />}
      </main>

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <button className={tela === 'inicio' ? 'active' : ''} onClick={() => setTela('inicio')}>
          <i className="ph ph-squares-four"></i>Início
        </button>
        {(s === 'pcp' || s === 'lider') && (
          <button className={tela === 'lider' ? 'active' : ''} onClick={() => setTela('lider')}>
            <i className="ph ph-users"></i>Líder
          </button>
        )}
        {(s === 'pcp' || s === 'producao' || s === 'lider') && (
          <button className={tela === 'operador' ? 'active' : ''} onClick={() => setTela('operador')}>
            <i className="ph ph-cooking-pot"></i>Produção
          </button>
        )}
        {s === 'embaladora' && (
          <button className={tela === 'embaladora' ? 'active' : ''} onClick={() => setTela('embaladora')}>
            <i className="ph ph-package"></i>Embaladora
          </button>
        )}
        {s === 'expedicao' && (
          <button className={tela === 'expedicao' ? 'active' : ''} onClick={() => setTela('expedicao')}>
            <i className="ph ph-snowflake"></i>Expedição
          </button>
        )}
        {s === 'pcp' && (
          <button className={tela === 'pcp' ? 'active' : ''} onClick={() => setTela('pcp')}>
            <i className="ph ph-chart-bar"></i>PCP
          </button>
        )}
      </nav>
    </div>
  );
}
