import PainelTV from './PainelTV';

// Este painel era uma versão antiga e paralela do Painel TV, com abas e
// dados diferentes (por isso o OEE e as pesagens não apareciam aqui).
// Agora aponta para o mesmo PainelTV.jsx — uma única fonte de verdade,
// para não ficarem dessincronizados de novo.
export default function ResumoPCP({ sair }) {
  return <PainelTV sair={sair} />;
}
