import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage, getToken, setToken } from '../api/client';
import { emptyCart, type AuthResult, type Cart, type User } from '../api/types';

interface Notice { message: string; kind: 'success' | 'error' | 'info' }
interface ShopState {
  user: User | null; cart: Cart; ready: boolean; busy: boolean; startupError: string;
  notice: Notice | null; notify: (message: string, kind?: Notice['kind']) => void; dismiss: () => void;
  reload: () => Promise<void>; refreshCart: () => Promise<void>;
  authenticate: (result: AuthResult) => void; logout: () => Promise<void>;
  add: (id: string) => Promise<void>; quantity: (id: string, quantity: number) => Promise<void>; remove: (id: string) => Promise<void>;
  orderCompleted: () => void;
}
const ShopContext = createContext<ShopState | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const notify = (message: string, kind: Notice['kind'] = 'info') => setNotice({ message, kind });
  const reload = useCallback(async () => {
    setReady(false); setStartupError('');
    try {
      let currentUser: User | null = null;
      if (getToken()) {
        try { currentUser = await api.me(); }
        catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
      }
      setUser(currentUser);
      setCart(await api.cart());
    } catch (error) { setStartupError(errorMessage(error)); }
    finally { setReady(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const expired = () => {
      setUser(null); setCart(emptyCart);
      setNotice({ message: 'Сессия завершилась. Войдите ещё раз — корзина аккаунта сохранена.', kind: 'info' });
    };
    window.addEventListener('forma:session-expired', expired);
    return () => window.removeEventListener('forma:session-expired', expired);
  }, []);
  async function mutate(action: () => Promise<Cart>, success?: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    try { setCart(await action()); if (success) notify(success, 'success'); }
    catch (error) { notify(errorMessage(error), 'error'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function logout() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      await api.logout(); setToken(null); setUser(null); setCart(await api.cart());
      // Explicit logout discards that account's local checkout draft, not its cart.
      if (user) sessionStorage.removeItem(`forma.checkout.${user.id}`);
      notify('Вы вышли из аккаунта. Ваша корзина сохранена.', 'info');
    } catch (error) { notify(errorMessage(error), 'error'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function authenticate(result: AuthResult) {
    setToken(result.token); setUser(result.user); setCart(result.cart);
    setNotice(result.warnings.length ? { message: result.warnings.join(' '), kind: 'info' } : null);
  }
  return <ShopContext.Provider value={{ user, cart, ready, busy, startupError, notice, notify, dismiss: () => setNotice(null), reload,
    refreshCart: async () => setCart(await api.cart()), authenticate, logout,
    add: id => mutate(() => api.add(id), 'Товар добавлен в корзину.'),
    quantity: (id, value) => mutate(() => api.quantity(id, value)),
    remove: id => mutate(() => api.remove(id)),
    orderCompleted: () => setCart(emptyCart),
  }}>{children}</ShopContext.Provider>;
}
export function useShop() {
  const context = useContext(ShopContext);
  if (!context) throw new Error('ShopProvider is required');
  return context;
}
