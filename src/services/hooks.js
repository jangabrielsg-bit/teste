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

// Itens de matéria-prima do sistema externo (Winthor/OS) que o PCP marcou
// como "ocultar" — sem cadastro válido ou sem saída. É só um filtro de
// visualização: não apaga nada no sistema de origem.
export function useMPOcultos() {
  const [ocultos, setOcultos] = useState({});
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'mpOcultos'), snap => {
      const mapa = {};
      snap.forEach(d => { mapa[d.id] = d.data(); });
      setOcultos(mapa);
    });
    return unsub;
  }, []);
  return ocultos;
}
