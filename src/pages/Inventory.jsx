import { Storefront, MagnifyingGlass } from '@phosphor-icons/react';

export default function Inventory() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Estoque Físico</h1>
          <p className="text-gray-400 text-sm mt-1">Gestão de câmaras frias e posições.</p>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-1 relative">
          <MagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl" />
          <input 
            type="text" 
            placeholder="Buscar por lote, produto ou OP..." 
            className="input-field pl-12"
          />
        </div>
        <select className="input-field w-48 bg-dark-card">
          <option>Todas as Câmaras</option>
          <option>Câmara 1</option>
          <option>Câmara 2</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {[1, 2].map((camara) => (
          <div key={camara} className="glass-card p-6">
            <div className="flex items-center justify-between mb-4 border-b border-gray-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gold/10 text-gold flex items-center justify-center">
                  <Storefront weight="duotone" className="text-xl" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-white">Câmara {camara}</h2>
                  <p className="text-xs text-gray-400">Capacidade: 20 Toneladas</p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-xl font-black text-green-400">65%</span>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Ocupada</p>
              </div>
            </div>
            
            <div className="space-y-3">
              {[1, 2, 3].map((_, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/30 border border-gray-700/30">
                  <div>
                    <span className="font-bold text-sm text-gray-200">PÃO FRANCÊS</span>
                    <div className="text-xs text-gray-500 mt-0.5">L-0807 • Val: 08/09/2026</div>
                  </div>
                  <div className="text-right font-mono font-bold text-gold">
                    260.00 kg
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
