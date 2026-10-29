import { Link } from 'react-router-dom';
import { useShop } from '../../app/ShopProvider';
import { money, ProductArt } from '../../components/ui';
import { OrderSummary } from './OrderSummary';

export function EmptyCart() {
  return <div className="fs-empty"><div className="fs-kicker">Корзина</div><h1>Пока здесь пусто</h1><p className="fs-muted">Начните с вещей, которые делают день приятнее.</p><Link className="fs-button fs-primary" to="/catalog">Перейти в каталог</Link></div>;
}
export function CartPage() {
  const { cart, quantity, remove, busy } = useShop();
  if (!cart.count) return <EmptyCart />;
  return <><div className="fs-kicker">Ваш выбор</div><h1>Корзина <span className="fs-muted">/ {cart.count}</span></h1><div className="fs-columns"><div>{cart.items.map(({ product, quantity: value }) => <article className="fs-line-item" key={product.id} data-testid={`cart-item-${product.id}`}><Link to={`/products/${product.id}`} aria-label={`Подробнее: ${product.name}`}><ProductArt product={product} /></Link><div><Link className="fs-link" to={`/products/${product.id}`}><h2 className="fs-product-title">{product.name}</h2></Link><span className="fs-muted fs-small">{money(product.price)} за штуку</span><div><div className="fs-quantity"><button disabled={value <= 1 || busy} onClick={() => void quantity(product.id, value - 1)} aria-label={`Уменьшить количество ${product.name}`}>−</button><span data-testid="item-quantity">{value}</span><button disabled={value >= product.stock || busy} onClick={() => void quantity(product.id, value + 1)} aria-label={`Увеличить количество ${product.name}`}>+</button></div> <button className="fs-link fs-small" disabled={busy} onClick={() => void remove(product.id)} aria-label={`Удалить ${product.name}`}>Удалить</button></div>{value > product.stock && <p className="fs-error">Доступно {product.stock} шт. Уменьшите количество.</p>}</div><span className="fs-price fs-item-price">{money(product.price * value)}</span></article>)}<Link className="fs-link fs-back fs-continue" to="/catalog">← Продолжить покупки</Link></div><OrderSummary /></div></>;
}
