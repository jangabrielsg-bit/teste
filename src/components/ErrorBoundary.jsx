import { Component } from 'react';

// Sem isto, um erro de render em qualquer tela derruba o React inteiro
// e deixa a página em branco — o único jeito de voltar é o operador
// recarregar manualmente (e, se o formulário não estava salvo, perder
// o que tinha digitado). Aqui, em vez de branco, mostra um aviso com
// botão de recarregar.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(erro, info) {
    console.error('Erro capturado pelo ErrorBoundary:', erro, info);
  }

  render() {
    if (this.state.erro) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: 24, textAlign: 'center', background: 'var(--bg, #fdfcfa)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 900, fontSize: '1.2rem', color: 'var(--marrom, #6b4423)', marginBottom: 8 }}>
            Algo deu errado nesta tela
          </div>
          <div style={{ color: '#999', fontSize: '0.9rem', marginBottom: 20, maxWidth: 420 }}>
            Os dados já digitados na fila de pesagem não foram perdidos — eles ficam salvos no aparelho.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ background: 'var(--marrom, #6b4423)', color: 'white', border: 'none', borderRadius: 12, padding: '14px 28px', fontWeight: 800, fontSize: '1rem', cursor: 'pointer' }}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
