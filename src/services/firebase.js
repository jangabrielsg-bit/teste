import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

// App Principal (Rastreio de Produção)
const firebaseConfig = {
  apiKey: "AIzaSyBYriLi3N0Z4ktETeBep8SweiN2rVHRAvs",
  authDomain: "rastreio-producao.firebaseapp.com",
  projectId: "rastreio-producao",
  storageBucket: "rastreio-producao.firebasestorage.app",
  messagingSenderId: "706467121350",
  appId: "1:706467121350:web:5193f6b64d8671b0c1afc7"
};

// App Estoque OS (Matéria Prima / Físico)
const appEstoqueConfig = {
  apiKey: "AIzaSyDev8spgKoKZi2pOohmk0r9SFLtLMcePa8",
  authDomain: "estoque-b50df.firebaseapp.com",
  projectId: "estoque-b50df",
  storageBucket: "estoque-b50df.firebasestorage.app",
  messagingSenderId: "634756791567",
  appId: "1:634756791567:web:993e61243b57b7e057d27a"
};

const app = initializeApp(firebaseConfig);
const appEstoque = initializeApp(appEstoqueConfig, "AppEstoque");

export const db = getFirestore(app);
export const dbEstoqueOS = getFirestore(appEstoque);
export const auth = getAuth(app);
const authEstoque = getAuth(appEstoque);

// Login anônimo automático para ambos
signInAnonymously(auth).catch(e => console.error('Erro login anônimo principal:', e.message));
signInAnonymously(authEstoque).catch(e => console.error('Erro login anônimo estoque:', e.message));

export { app, appEstoque };
