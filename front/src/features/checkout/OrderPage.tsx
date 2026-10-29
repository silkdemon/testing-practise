import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useResource } from '../../app/useResource';
import { ErrorState, Loading, money, NotFound } from '../../components/ui';

export function OrderPage() {
  const { id = '' } = useParams();
  const { data: order, error, loading, retry } = useResource(signal => api.order(id, signal), [id]);
  if (loading) return <Loading label="Загружаем заказ…" />;
  if (error instanceof ApiError && error.status === 404) return <NotFound title="Заказ не найден" />;
  if (error) return <ErrorState error={error} retry={retry} />;
  if (!order) return null;
  return <section className="fs-success"><div className="fs-success-mark" aria-hidden="true">✓</div><div className="fs-kicker" data-testid="order-number">Заказ № {order.number}</div><h1>Всё получилось!</h1><p className="fs-muted">Учебный заказ создан.<br />Спасибо, что выбрали «форму».</p><div className="fs-panel">{order.items.map(({ product, quantity }) => <div className="fs-row" key={product.id}><span>{product.name} <span className="fs-muted">× {quantity}</span></span><span className="fs-nowrap">{money(product.price * quantity)}</span></div>)}<div className="fs-row fs-total"><span>Итого</span><span data-testid="order-total">{money(order.total)}</span></div></div><Link className="fs-button fs-primary" to="/catalog">Вернуться в каталог</Link></section>;
}
