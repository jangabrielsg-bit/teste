import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { hojeISO } from '../services/utils';

export default function GlobalTicker() {
  const [parada, setParada] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'producaoDiaria', hojeISO()), (snap) => {
      if (snap.exists() && snap.data().paradaEmergencia?.ativa) {
        setParada(snap.data().paradaEmergencia);
      } else {
        setParada(null);
      }
    });
    return unsub;
  }, []);

  if (!parada) return null;

  return (
    <div className="ticker-emergencia">
      <div className="ticker-track">
        <span>⚠️ ALERTA: {parada.motivo || 'PRODUÇÃO PARADA'} ⚠️</span>
        <span>⚠️ ALERTA: {parada.motivo || 'PRODUÇÃO PARADA'} ⚠️</span>
        <span>⚠️ ALERTA: {parada.motivo || 'PRODUÇÃO PARADA'} ⚠️</span>
      </div>
    </div>
  );
}
