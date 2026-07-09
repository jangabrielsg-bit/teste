import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

export function useProdutos() {
  const [produtos, setProdutos] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'produtos'), orderBy('categoria'));
    const unsub = onSnapshot(q, (snap) => {
      const lista = [];
      snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
      setProdutos(lista);
      setCarregando(false);
    });
    return unsub;
  }, []);

  return { produtos, carregando };
}
