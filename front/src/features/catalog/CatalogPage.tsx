import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useResource } from '../../app/useResource';
import { useShop } from '../../app/ShopProvider';
import { ErrorState, Loading, money, ProductArt } from '../../components/ui';

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const { add, busy } = useShop();
  const query = params.toString();
  const { data, error, loading, retry } = useResource(signal => api.products(query, signal), [query]);
  function update(key: string, value: string, replace = false) {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace });
  }
  return <>
    <section className="fs-hero"><div><div className="fs-kicker">Коллекция / каждый день</div><h1>Техника для<br />вашего ритма.</h1><p className="fs-muted">Для любимой музыки, спокойной работы<br />и маленьких домашних ритуалов.</p></div><div className="fs-stamp" aria-hidden="true"><b>форма</b>ПРОСТОЕ<br />И НУЖНОЕ</div></section>
    <div className="fs-controls"><label className="fs-search"><span className="fs-sr">Поиск товаров</span><input type="search" placeholder="Найти что-то своё" value={params.get('q') || ''} onChange={event => update('q', event.target.value, true)} data-testid="catalog-search" /></label><label><span className="fs-sr">Сортировка</span><select className="fs-sort" value={params.get('sort') || ''} onChange={event => update('sort', event.target.value)}><option value="">По умолчанию</option><option value="price-asc">Сначала дешевле</option><option value="price-desc">Сначала дороже</option></select></label></div>
    <div className="fs-chips" aria-label="Категории">{['Все товары', 'Аудио', 'Для работы', 'Для дома'].map(category => <button key={category} className="fs-chip" aria-pressed={(params.get('category') || 'Все товары') === category} onClick={() => update('category', category === 'Все товары' ? '' : category)}>{category}</button>)}</div>
    {loading ? <Loading label="Подбираем товары…" /> : error ? <ErrorState error={error} retry={retry} /> : !data?.length ? <div className="fs-empty"><h2>Ничего не нашлось</h2><p className="fs-muted">Попробуйте другой запрос или уберите фильтры.</p><button className="fs-button" onClick={() => setParams({})}>Сбросить фильтры</button></div> : <><p className="fs-small fs-muted" role="status">Найдено товаров: {data.length}</p><div className="fs-grid">{data.map(product => <article className="fs-product" key={product.id} data-testid={`product-${product.id}`}>
      <Link className="fs-art-button" to={`/products/${product.id}`} aria-label={`Подробнее: ${product.name}`}><ProductArt product={product} badge /></Link>
      <div className="fs-product-info"><Link className="fs-link" to={`/products/${product.id}`}><h2 className="fs-product-title">{product.name}</h2></Link><div className="fs-muted fs-small">{product.description}</div><div className="fs-product-bottom"><span className="fs-price">{money(product.price)}</span><button className="fs-button fs-primary" disabled={!product.stock || busy} onClick={() => void add(product.id)}>{product.stock ? 'В корзину' : 'Нет в наличии'}</button></div></div>
    </article>)}</div></>}
  </>;
}
