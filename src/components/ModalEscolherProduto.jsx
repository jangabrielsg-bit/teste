export default function ModalEscolherProduto({ produtos, aoEscolher, aoFechar }) {
  const porCategoria = {};
  produtos.forEach(p => {
    const cat = p.categoria || 'Sem setor';
    if (!porCategoria[cat]) porCategoria[cat] = [];
    porCategoria[cat].push(p);
  });

  return (
    <div className="modal-fundo" onClick={aoFechar}>
      <div className="modal-caixa" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Escolha a receita</span>
          <button className="fechar-btn" onClick={aoFechar}>✕</button>
        </div>
        <div className="modal-scroll">
          {Object.keys(porCategoria).length === 0 && (
            <div className="status-msg">Nenhum produto cadastrado ainda. Vá em "Produtos e Setores" no início.</div>
          )}
          {Object.keys(porCategoria).sort().map(cat => (
            <div key={cat}>
              <div className="cat-heading">{cat}</div>
              <div className="produto-grid">
                {porCategoria[cat].map(p => (
                  <button key={p.id} className="produto-btn" onClick={() => aoEscolher(p)}>{p.nome}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
