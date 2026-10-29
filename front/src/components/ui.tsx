import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client';
import type { Product } from '../api/types';

export const money = (kopecks: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: kopecks % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(kopecks / 100);

export function ProductArt({ product, badge = false }: { product: Pick<Product, 'art' | 'tone' | 'name' | 'stock' | 'badge'>; badge?: boolean }) {
  return <div className={`fs-art ${product.tone}`} role="img" aria-label={product.name}>
    {badge && (!product.stock || product.badge) && <span className="fs-badge">{product.stock ? product.badge : 'Нет в наличии'}</span>}
    <div className={`fs-device ${product.art}`} aria-hidden="true" />
  </div>;
}
export function Loading({ label = 'Загружаем…' }: { label?: string }) {
  return <div className="fs-loading" role="status"><span className="fs-spinner" aria-hidden="true" />{label}</div>;
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="fs-empty"><h2>Не получилось загрузить</h2><p className="fs-muted" role="alert">{errorMessage(error)}</p>{retry && <button className="fs-button fs-primary" onClick={retry}>Попробовать ещё раз</button>}</div>;
}
export function NotFound({ title = 'Страница не найдена' }: { title?: string }) {
  return <div className="fs-empty"><div className="fs-kicker">404</div><h1>{title}</h1><p className="fs-muted">Возможно, адрес изменился. В каталоге всё на месте.</p><Link className="fs-button fs-primary" to="/catalog">Перейти в каталог</Link></div>;
}
