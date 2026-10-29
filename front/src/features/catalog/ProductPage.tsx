import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useShop } from '../../app/ShopProvider';
import { useResource } from '../../app/useResource';
import { ErrorState, Loading, money, NotFound, ProductArt } from '../../components/ui';

export function ProductPage() {
  const { id = '' } = useParams();
  const { add, busy } = useShop();
  const { data: product, error, loading, retry } = useResource(signal => api.product(id, signal), [id]);
  if (loading) return <Loading label="Загружаем товар…" />;
  if (error instanceof ApiError && error.status === 404) return <NotFound title="Товар не найден" />;
  if (error) return <ErrorState error={error} retry={retry} />;
  if (!product) return null;
  return <><Link className="fs-link fs-back" to="/catalog">← Каталог</Link><section className="fs-detail"><ProductArt product={product} badge /><div><div className="fs-kicker">{product.category}</div><h1>{product.name}</h1><p className="fs-muted">{product.detail}</p><div className="fs-stock">{product.stock ? `В наличии · ${product.stock} шт.` : 'Сейчас нет в наличии'}</div><span className="fs-price">{money(product.price)}</span><button className="fs-button fs-primary fs-full" disabled={!product.stock || busy} onClick={() => void add(product.id)}>{product.stock ? 'Добавить в корзину' : 'Нет в наличии'}</button><dl className="fs-specs">{product.specs.map(spec => <div key={spec.label}><dt className="fs-muted">{spec.label}</dt><dd>{spec.value}</dd></div>)}</dl></div></section></>;
}
