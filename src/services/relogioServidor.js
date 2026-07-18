// ── Relógio interno sincronizado com o servidor ────────────────────
// Cada dispositivo (tablet do operador, TV, PC do PCP) tem seu próprio
// relógio de hardware, que pode estar errado, atrasado, ou em fuso
// diferente. Se cada tela carimbar os eventos com `new Date()` local,
// batidas/paradas registradas em aparelhos diferentes ficam
// inconsistentes entre si — quebra o cálculo de velocidade, OEE, etc.
//
// Aqui calibramos, uma vez por sessão (e a cada 5 min), a diferença
// entre o relógio do dispositivo e o relógio do servidor do Firestore
// (fonte única de verdade). Depois disso, `agoraServidor()` devolve a
// hora corrigida, e todo o app deve usar essa função — nunca `new Date()`
// direto — para carimbar eventos ou calcular durações/velocidades.

import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from './firebase';

const REF_RELOGIO = doc(db, '_sistema', 'relogio');
const INTERVALO_RECALIBRACAO_MS = 5 * 60 * 1000;

let offsetMs = 0;
let calibrado = false;
const ouvintes = new Set();

function avisarOuvintes() {
  ouvintes.forEach(fn => fn());
}

function calibrar() {
  const unsub = onSnapshot(REF_RELOGIO, snap => {
    // Ignora a confirmação otimista local — só a resposta do servidor
    // (sem pendingWrites) tem o timestamp real resolvido.
    if (snap.metadata.hasPendingWrites) return;
    const ts = snap.data()?.ts;
    if (!ts) return;
    offsetMs = ts.toMillis() - Date.now();
    calibrado = true;
    avisarOuvintes();
    unsub();
  }, () => { /* sem permissão ou offline — mantém offset em 0 (usa hora local) */ });

  setDoc(REF_RELOGIO, { ts: serverTimestamp() }).catch(() => { unsub(); });
}

calibrar();
setInterval(calibrar, INTERVALO_RECALIBRACAO_MS);

/** Hora atual corrigida pelo offset do servidor. Use esta função em vez de `new Date()`
 *  para qualquer timestamp que vá ser salvo ou comparado entre dispositivos. */
export function agoraServidor() {
  return new Date(Date.now() + offsetMs);
}

export function relogioEstaCalibrado() {
  return calibrado;
}

/** Hook: hora do servidor, atualizada a cada segundo — para relógios e contadores na tela. */
export function useRelogioServidor() {
  const [, forcarRender] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forcarRender(v => v + 1), 1000);
    ouvintes.add(forcarRender);
    return () => { clearInterval(t); ouvintes.delete(forcarRender); };
  }, []);
  return agoraServidor();
}
