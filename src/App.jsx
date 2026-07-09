import { Routes, Route } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import Dashboard from './pages/Dashboard';
import Inbound from './pages/Inbound';
import Inventory from './pages/Inventory';
import Outbound from './pages/Outbound';

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="inbound" element={<Inbound />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="outbound" element={<Outbound />} />
      </Route>
    </Routes>
  );
}

export default App;
