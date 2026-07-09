import { useState } from 'react';

export default function ModalTeclado({ titulo, valorInicial, aoConfirmar, aoFechar }) {
  const [valor, setValor] = useState(valorInicial ? String(valorInicial).replace('.', ',') : '');

  function digitar(d) {
    if (d === ',') {
      if (valor.includes(',')) return;
      setValor(valor === '' ? '0,' : valor + ',');
    } else if (d === '⌫') {
      setValor(valor.slice(0, -1));
    } else if (d === 'C') {
      setValor('');
    } else {
      if (valor.length >= 8) return;
      setValor(valor + d);
    }
  }

  function confirmar() {
    const num = parseFloat(valor.replace(',', '.')) || 0;
    aoConfirmar(num);
  }

  return (
    <div className="modal-fundo" onClick={aoFechar}>
      <div className="modal-caixa" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{titulo}</span>
          <button className="fechar-btn" onClick={aoFechar}>✕</button>
        </div>
        <div className="teclado-display">
          {valor === '' ? '0' : valor} <span className="teclado-unidade">kg</span>
        </div>
        <div className="teclado-grid">
          {['1','2','3','4','5','6','7','8','9','C','0',','].map(d => (
            <button key={d} className={'teclado-btn' + (d === 'C' ? ' teclado-limpar' : '')} onClick={() => digitar(d)}>{d}</button>
          ))}
        </div>
        <div className="teclado-acoes">
          <button className="btn btn-outline btn-block" onClick={() => digitar('⌫')}>⌫ Apagar</button>
          <button className="btn btn-primary btn-block" onClick={confirmar}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}
