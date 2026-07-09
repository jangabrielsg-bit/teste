import { useState } from 'react';
import { useAuth } from '../services/auth';

export default function Login() {
  const { login } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setErro('');
    setLoading(true);
    await new Promise(r => setTimeout(r, 400));
    const result = login(usuario, senha);
    if (!result.ok) setErro(result.erro);
    setLoading(false);
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src={import.meta.env.BASE_URL + 'logo.png'} alt="IMAC" style={{ height: 80, marginBottom: 16 }} />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--marrom)' }}>Acesso ao Sistema</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--marrom-claro)', marginTop: 4 }}>IMAC — Indústria de Massas Congeladas</p>
        </div>
        {erro && <div style={{ background: '#fef2f2', color: '#dc2626', padding: 12, borderRadius: 10, marginBottom: 16, fontSize: '0.9rem', textAlign: 'center', fontWeight: 600 }}>{erro}</div>}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--marrom)', marginBottom: 6 }}>Usuário</label>
            <input type="text" className="input-texto" placeholder="Ex: pcp, lider, producao..." value={usuario} onChange={e => setUsuario(e.target.value)} required />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--marrom)', marginBottom: 6 }}>Senha</label>
            <input type="password" className="input-texto" value={senha} onChange={e => setSenha(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
