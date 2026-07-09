import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';

const AuthContext = createContext(null);

const USUARIOS_FIXOS = {
  'lider': { senhaPadrao: 'lider123', setor: 'lider' },
  'producao': { senhaPadrao: 'producao123', setor: 'producao' },
  'embaladora': { senhaPadrao: 'embaladora123', setor: 'embaladora' },
  'expedicao': { senhaPadrao: 'expedicao123', setor: 'expedicao' },
  'pcp': { senhaPadrao: 'pcp123', setor: 'pcp' }
};

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('imac_user')); } catch { return null; }
  });
  const [firebasePronto, setFirebasePronto] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) setFirebasePronto(true);
    });
    return unsub;
  }, []);

  function login(usuario, senha) {
    const userKey = usuario.toLowerCase().trim();
    const dados = USUARIOS_FIXOS[userKey];
    if (!dados) return { ok: false, erro: 'Usuário não encontrado.' };
    const senhaValida = localStorage.getItem('imac_pwd_' + userKey) || dados.senhaPadrao;
    if (senhaValida !== senha) return { ok: false, erro: 'Senha incorreta.' };
    const user = { id: userKey, setor: dados.setor };
    localStorage.setItem('imac_user', JSON.stringify(user));
    setCurrentUser(user);
    return { ok: true, user };
  }

  function logout() {
    localStorage.removeItem('imac_user');
    setCurrentUser(null);
  }

  function trocarSenha(senhaAntiga, senhaNova) {
    if (!currentUser) return false;
    const userKey = currentUser.id;
    const senhaAtual = localStorage.getItem('imac_pwd_' + userKey) || USUARIOS_FIXOS[userKey]?.senhaPadrao;
    if (senhaAtual !== senhaAntiga) return false;
    localStorage.setItem('imac_pwd_' + userKey, senhaNova);
    return true;
  }

  return (
    <AuthContext.Provider value={{ currentUser, firebasePronto, login, logout, trocarSenha }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
