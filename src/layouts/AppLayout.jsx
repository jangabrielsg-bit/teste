import { Outlet, NavLink } from 'react-router-dom';
import { SquaresFour, BoxArrowDown, Storefront, Package } from '@phosphor-icons/react';
import clsx from 'clsx';

export default function AppLayout() {
  const menuItems = [
    { name: 'Dashboard', path: '/', icon: SquaresFour },
    { name: 'Inbound', path: '/inbound', icon: BoxArrowDown },
    { name: 'Estoque', path: '/inventory', icon: Storefront },
    { name: 'Expedição', path: '/outbound', icon: Package },
  ];

  return (
    <div className="flex min-h-screen bg-[#151A22] text-gray-200 font-sans">
      {/* Sidebar */}
      <aside className="w-64 glass-panel border-r border-gray-800 flex flex-col z-20">
        <div className="p-6 flex items-center gap-3 border-b border-gray-800">
          <div className="w-10 h-10 bg-gold rounded-xl flex items-center justify-center text-stone-900 font-black text-xl shadow-[0_0_15px_rgba(246,190,0,0.4)]">
            W
          </div>
          <div>
            <h1 className="font-black text-white text-xl tracking-wide">IMAC WMS</h1>
            <p className="text-[10px] text-gold uppercase font-bold tracking-wider">SaaS Edition</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all',
                  isActive
                    ? 'bg-gold/10 text-gold border border-gold/20'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                )
              }
            >
              <item.icon weight="fill" className="text-xl" />
              {item.name}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <div className="bg-[#1D2530] p-4 rounded-xl border border-gray-800 text-xs">
            <p className="text-gray-400 font-bold mb-1">Status do Sistema</p>
            <div className="flex items-center gap-2 text-green-400 font-bold">
              <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></span>
              Online
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Glow effect in background */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-gold/5 blur-[120px] rounded-full pointer-events-none"></div>
        
        <header className="h-20 glass-panel flex items-center justify-between px-8 z-10 border-b border-gray-800">
          <h2 className="text-xl font-black text-white">Gestão de Armazém</h2>
          <div className="flex items-center gap-4">
            <button className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center border border-gray-700 hover:border-gold transition-colors">
              <img src="/logo.png" alt="User" className="w-6 h-6 object-contain" onError={(e) => e.target.style.display = 'none'} />
            </button>
          </div>
        </header>

        <div className="flex-1 p-8 overflow-auto z-10 relative">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
