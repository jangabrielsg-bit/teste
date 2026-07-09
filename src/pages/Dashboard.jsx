import { TrendUp, BoxArrowDown, Storefront, Package } from '@phosphor-icons/react';

export default function Dashboard() {
  const stats = [
    { title: 'Entradas (Hoje)', value: '14 Lotes', icon: BoxArrowDown, color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' },
    { title: 'Ocupação das Câmaras', value: '82%', icon: Storefront, color: 'text-gold', bg: 'bg-gold/10', border: 'border-gold/20' },
    { title: 'Expedição (Hoje)', value: '2.4 T', icon: Package, color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/20' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Dashboard Overview</h1>
          <p className="text-gray-400 text-sm mt-1">Visão geral da operação de armazenamento.</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <TrendUp weight="bold" /> Gerar Relatório
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className={`glass-card p-6 border-l-4 hover:scale-[1.02] transition-transform ${stat.border.replace('border-', 'border-l-')}`}>
            <div className="flex justify-between items-start">
              <div>
                <p className="text-gray-400 font-bold text-sm">{stat.title}</p>
                <p className="text-3xl font-black text-white mt-2">{stat.value}</p>
              </div>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${stat.bg} ${stat.color}`}>
                <stat.icon weight="duotone" className="text-2xl" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6 mt-8">
        <div className="glass-card p-6">
          <h3 className="font-bold text-gold mb-4 uppercase tracking-wider text-xs">Atividade Recente</h3>
          <div className="space-y-4">
            {[1, 2, 3].map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-gray-800/50 border border-gray-700/50">
                <div className="w-2 h-2 rounded-full bg-gold shadow-[0_0_8px_#F6BE00]"></div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-white">Lote L-0807 (Pão Francês)</p>
                  <p className="text-xs text-gray-400">Armazenado na Câmara 2</p>
                </div>
                <span className="text-xs font-mono text-gray-500">14:32</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="font-bold text-gold mb-4 uppercase tracking-wider text-xs">Avisos do Sistema</h3>
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
            <span className="legend-indicator flex-shrink-0 mt-0.5">!</span>
            <div>
              <p className="text-sm font-bold text-red-400">Câmara Fria 1 próximo do limite</p>
              <p className="text-xs text-red-400/80 mt-1">A ocupação atual é de 94%. Realoque os produtos mais antigos (FEFO).</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
