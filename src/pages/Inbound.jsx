import { BoxArrowDown, Plus } from '@phosphor-icons/react';

export default function Inbound() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">Recebimento (Inbound)</h1>
          <p className="text-gray-400 text-sm mt-1">Registrar entrada de produtos acabados vindos da produção.</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus weight="bold" /> Novo Recebimento
        </button>
      </div>

      <div className="glass-card p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-blue-400/10 text-blue-400 flex items-center justify-center">
            <BoxArrowDown weight="duotone" className="text-2xl" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Lotes Pendentes de Guarda</h2>
            <p className="text-gray-400 text-sm">Produção finalizada na embaladora aguardando entrada nas câmaras.</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                <th className="pb-3 font-bold">Lote / OP</th>
                <th className="pb-3 font-bold">Produto</th>
                <th className="pb-3 font-bold">Hora Fim</th>
                <th className="pb-3 font-bold text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {[1, 2].map((_, i) => (
                <tr key={i} className="hover:bg-gray-800/20 transition-colors">
                  <td className="py-4">
                    <span className="bg-gray-800 text-gold px-2 py-1 rounded font-mono text-xs font-bold border border-gray-700">L-0807</span>
                    <span className="ml-2 text-xs text-gray-500">OP: 63121</span>
                  </td>
                  <td className="py-4">
                    <span className="font-bold text-white">PÃO FRANCÊS</span>
                  </td>
                  <td className="py-4 text-gray-400 text-sm font-mono">19:05</td>
                  <td className="py-4 text-right">
                    <button className="bg-dark-card hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-bold border border-gray-600 transition-colors">
                      Guardar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Empty state could go here */}
        </div>
      </div>
    </div>
  );
}
