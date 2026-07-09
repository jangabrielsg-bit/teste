import { AuthProvider, useAuth } from './services/auth';
import Login from './pages/Login';
import AppLayout from './layouts/AppLayout';

function AppContent() {
  const { currentUser, firebasePronto } = useAuth();

  if (!firebasePronto) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100%', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', flexDirection: 'column', gap: 16 }}>
        <img src={import.meta.env.BASE_URL + 'logo.png'} alt="IMAC" style={{ height: 60, opacity: 0.6 }} />
        <div style={{ color: 'var(--marrom-claro)', fontWeight: 600 }}>Conectando ao banco de dados...</div>
      </div>
    );
  }

  if (!currentUser) {
    return <Login />;
  }

  return <AppLayout />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
