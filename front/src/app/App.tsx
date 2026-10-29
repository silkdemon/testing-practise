import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ShopProvider, useShop } from './ShopProvider';
import { ErrorState, Loading, NotFound } from '../components/ui';
import { CatalogPage } from '../features/catalog/CatalogPage';
import { ProductPage } from '../features/catalog/ProductPage';
import { AuthPage } from '../features/auth/AuthPage';
import { CartPage } from '../features/cart/CartPage';
import { CheckoutPage } from '../features/checkout/CheckoutPage';
import { OrderPage } from '../features/checkout/OrderPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useShop();
  const location = useLocation();
  return user ? children : <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
}
function Shell() {
  const { user, cart, ready, busy, logout, notice, dismiss, startupError, reload } = useShop();
  const { pathname } = useLocation();
  useEffect(() => {
    const title = pathname === '/catalog' ? 'Каталог' : pathname === '/cart' ? 'Корзина' : pathname === '/login' ? 'Вход' : pathname === '/register' ? 'Регистрация' : pathname === '/checkout' ? 'Оформление заказа' : pathname.startsWith('/orders/') ? 'Заказ создан' : 'Магазин';
    document.title = `${title} — Форма`;
    window.scrollTo(0, 0);
  }, [pathname]);
  return <div id="forma-shop"><a className="fs-skip" href="#main">Перейти к содержимому</a><header className="fs-header"><Link className="fs-brand" to="/catalog" aria-label="Форма — перейти в каталог"><span className="fs-mark" aria-hidden="true" />форма</Link><Link className="fs-link fs-catalog-link" to="/catalog">Каталог</Link><nav className="fs-nav" aria-label="Основная навигация">{user ? <><span className="fs-account-name fs-muted" data-testid="account-name">{user.name}</span><button className="fs-link" onClick={() => void logout()} disabled={busy}>Выйти</button></> : <Link className="fs-link" to={`/login?returnTo=${pathname === '/cart' ? '%2Fcart' : '%2Fcatalog'}`}>Войти</Link>}<Link className="fs-link fs-cart-link" to="/cart">Корзина <span className="fs-count" data-testid="cart-count">{cart.count}</span></Link></nav></header><main className="fs-main" id="main">{notice && <div className={`fs-notice fs-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span>{notice.message}</span><button className="fs-link" aria-label="Закрыть уведомление" onClick={dismiss}>×</button></div>}{!ready ? <Loading label="Открываем магазин…" /> : startupError ? <ErrorState error={new Error(startupError)} retry={() => void reload()} /> : <Outlet />}</main><footer className="fs-footer"><span>форма — вещи для повседневной жизни</span><span>Учебный магазин · без реальных покупок</span></footer></div>;
}
export function App() {
  return <BrowserRouter><ShopProvider><Routes><Route element={<Shell />}><Route index element={<Navigate to="/catalog" replace />} /><Route path="catalog" element={<CatalogPage />} /><Route path="products/:id" element={<ProductPage />} /><Route path="cart" element={<CartPage />} /><Route path="login" element={<AuthPage key="login" />} /><Route path="register" element={<AuthPage key="register" register />} /><Route path="checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} /><Route path="orders/:id" element={<RequireAuth><OrderPage /></RequireAuth>} /><Route path="*" element={<NotFound />} /></Route></Routes></ShopProvider></BrowserRouter>;
}
