import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBYriLi3N0Z4ktETeBep8SweiN2rVHRAvs",
  authDomain: "rastreio-producao.firebaseapp.com",
  projectId: "rastreio-producao",
  storageBucket: "rastreio-producao.firebasestorage.app",
  messagingSenderId: "706467121350",
  appId: "1:706467121350:web:5193f6b64d8671b0c1afc7"
};

const appEstoqueConfig = {
  apiKey: "AIzaSyDev8spgKoKZi2pOohmk0r9SFLtLMcePa8",
  authDomain: "estoque-b50df.firebaseapp.com",
  projectId: "estoque-b50df",
  storageBucket: "estoque-b50df.firebasestorage.app",
  messagingSenderId: "634756791567",
  appId: "1:634756791567:web:993e61243b57b7e057d27a"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

export const appEstoque = initializeApp(appEstoqueConfig, "AppEstoque");
export const dbEstoqueOS = getFirestore(appEstoque);
export const authEstoque = getAuth(appEstoque);

// Anonymous login as per legacy implementation
signInAnonymously(auth).catch(console.error);
signInAnonymously(authEstoque).catch(console.error);
