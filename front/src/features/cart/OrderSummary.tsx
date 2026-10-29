import { Link } from 'react-router-dom';
import { useShop } from '../../app/ShopProvider';
import { money } from '../../components/ui';

export function OrderSummary({ checkout = false }: { checkout?: boolean }) {
  const { cart, user, busy } = useShop();
  return <aside className="fs-panel fs-summary"><h2>Ваш заказ</h2>{checkout && cart.items.map(({ product, quantity }) => <div className="fs-order-mini" key={product.id}><h3>{product.name}</h3><div className="fs-row fs-small"><span className="fs-muted">{quantity} шт.</span><span>{money(product.price * quantity)}</span></div></div>)}<div className="fs-row"><span className="fs-muted">Товары ({cart.count})</span><span>{money(cart.total)}</span></div><div className="fs-row"><span className="fs-muted">Доставка</span><span>Бесплатно</span></div><div className="fs-row fs-total"><span>Итого</span><span data-testid="cart-total">{money(cart.total)}</span></div>{checkout ? <p className="fs-note">Учебный заказ. Оплата не требуется.</p> : <>{busy ? <button className="fs-button fs-primary fs-full" disabled>Обновляем корзину…</button> : <Link className="fs-button fs-primary fs-full" to="/checkout">Оформить заказ →</Link>}{!user && <p className="fs-note">Для оформления нужно войти.<br />Ваша корзина сохранится.</p>}</>}</aside>;
}
