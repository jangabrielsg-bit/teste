import { Package, Scales } from '@phosphor-icons/react';
import { useState } from 'react';

export default function Outbound() {
  const [peso, setPeso] = useState('130.50');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Expedição (Outbound)</h1>
          <p className="text-gray-400 text-sm mt-1">Pesagem de patinhas e montagem de carga.</p>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-3 glass-card p-6">
          <div className="flex items-center gap-3 mb-6 border-b border-gray-800 pb-4">
            <Scales weight="duotone" className="text-2xl text-gold" />
            <h2 className="text-xl font-bold text-white">Conferência de Peso</h2>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-1">Responsável</label>
                <input type="text" className="input-field" placeholder="Ex: João" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-1">Lote Físico</label>
                <input type="text" className="input-field font-mono" value="L-0807" readOnly />
              </div>
            </div>

            <div className="bg-[#151A22] p-6 rounded-xl border border-gray-800 text-center">
              <label className="block text-sm font-bold text-gold mb-2 uppercase tracking-widest">Peso da Patinha</label>
              <div className="text-5xl font-black text-white font-mono tracking-tight cursor-pointer hover:text-gold transition-colors">
                {peso} <span className="text-2xl text-gray-500">kg</span>
              </div>
            </div>

            <button className="btn-primary w-full text-lg py-4">
              Adicionar à Conferência
            </button>
          </div>
        </div>

        <div className="col-span-2 space-y-6">
          <div className="glass-card p-6">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <Package className="text-gold" /> Resumo do Lote
            </h3>
            
            <div className="bg-gray-800/30 p-4 rounded-xl border border-gray-700/50 grid grid-cols-3 text-center gap-2">
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-bold">Esperado</div>
                <div className="font-black text-white mt-1">260 kg</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-bold">Real</div>
                <div className="font-black text-white mt-1">258.7 kg</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-bold">Desvio</div>
                <div className="font-black text-red-400 mt-1">-0.50%</div>
              </div>
            </div>

            <div className="mt-6">
              <button className="btn-secondary w-full text-green-400 border-green-500/30 hover:bg-green-500/10">
                Confirmar e Liberar Carga
              </button>
            </div>
          </div>

          <div className="bg-gold/10 border-l-4 border-gold p-4 rounded-r-xl">
            <h4 className="font-bold text-gold text-sm">Instruções</h4>
            <p className="text-xs text-gold/80 mt-1 leading-relaxed">
              Pese as patinhas individualmente. A soma alimentará o Estoque de Produto Acabado.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
