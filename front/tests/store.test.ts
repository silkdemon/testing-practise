import { beforeEach, describe, expect, it } from 'vitest';
import { MockError, MockStore, type Identity, type StorageLike } from '../src/mocks/store';
import type { CheckoutInput } from '../src/api/types';

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) || null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const guest: Identity = { token: null, guest: 'guest-a' };
const delivery: CheckoutInput = { name: 'Тестовый покупатель', email: 'buyer@example.com', phone: '+7 000 000-00-00', city: 'Тестовый город', address: 'Учебная улица, 1', comment: '' };
let store: MockStore;
let storage: MemoryStorage;
async function signIn() {
  const auth = await store.login({ email: 'demo@example.com', password: 'Demo12345' }, guest.guest);
  return { token: auth.token, guest: guest.guest };
}
beforeEach(async () => { storage = new MemoryStorage(); store = new MockStore(storage); await store.initialize(); });

describe('catalog and guest cart', () => {
  it('combines search, category and numeric price ordering', () => {
    const products = store.list(new URLSearchParams('category=Аудио&sort=price-asc'));
    expect(products.map(p => p.id)).toEqual(['sound-mini', 'air-buds', 'quiet-one']);
    expect(store.list(new URLSearchParams('q=QUIET'))[0].id).toBe('quiet-one');
    expect(store.list(new URLSearchParams('q=does-not-exist'))).toEqual([]);
  });
  it('persists guest quantities and totals through a fresh store instance', async () => {
    store.setQuantity(guest, 'quiet-one', 1, true);
    store.setQuantity(guest, 'quiet-one', 1, true);
    const restored = new MockStore(storage); await restored.initialize();
    expect(restored.cart(guest).count).toBe(2);
    expect(restored.cart(guest).total).toBe(1798000);
    expect(restored.setQuantity(guest, 'quiet-one', 0).items).toEqual([]);
  });
  it('rejects fractional, negative and unavailable quantities without changing the cart', () => {
    for (const quantity of [-1, 1.5, 9]) expect(() => store.setQuantity(guest, 'quiet-one', quantity)).toThrow(MockError);
    expect(() => store.setQuantity(guest, 'air-buds', 1)).toThrow('нет в наличии');
    expect(store.cart(guest).count).toBe(0);
  });
  it('isolates separate guests', () => {
    store.setQuantity(guest, 'point', 2);
    expect(store.cart({ token: null, guest: 'guest-b' }).count).toBe(0);
  });
});

describe('authentication and cart ownership', () => {
  it('checks passwords and normalized email uniqueness', async () => {
    await expect(store.login({ email: 'demo@example.com', password: 'incorrect' }, guest.guest)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(store.register({ name: 'Тест', email: ' DEMO@example.com ', password: 'Demo12345' }, guest.guest)).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    const result = await store.register({ name: 'Новый покупатель', email: ' NEW@example.com ', password: 'Newpass123' }, guest.guest);
    expect(result.user.email).toBe('new@example.com');
    expect(store.me({ token: result.token, guest: guest.guest }).id).toBe(result.user.id);
    expect(storage.getItem('forma.mock-db.v1')).not.toContain('Newpass123');
  });
  it('rejects invalid registration and makes no partial user', async () => {
    await expect(store.register({ name: '', email: 'broken', password: '123' }, guest.guest)).rejects.toMatchObject({ status: 422 });
    await expect(store.login({ email: 'broken', password: '123' }, guest.guest)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
  it('merges baskets once, caps the stock, and keeps the account cart on logout', async () => {
    const account = await signIn();
    store.setQuantity(account, 'quiet-one', 6);
    store.logout(account);
    expect(store.cart(guest).count).toBe(0);
    store.setQuantity(guest, 'quiet-one', 4);
    const auth = await store.login({ email: 'demo@example.com', password: 'Demo12345' }, guest.guest);
    expect(auth.cart.count).toBe(8);
    expect(auth.warnings).toHaveLength(1);
    expect(store.cart(guest).count).toBe(0);
    const again = await store.login({ email: 'demo@example.com', password: 'Demo12345' }, guest.guest);
    expect(again.cart.count).toBe(8);
  });
  it('rejects an invalid session instead of silently mutating a guest cart', () => {
    expect(() => store.setQuantity({ ...guest, token: 'expired' }, 'point', 1)).toThrow(MockError);
    expect(store.cart(guest).count).toBe(0);
  });
});

describe('order lifecycle', () => {
  it('requires login and a non-empty cart', async () => {
    expect(() => store.createOrder(guest, delivery, 0, 'key')).toThrow(MockError);
    const account = await signIn();
    expect(() => store.createOrder(account, delivery, 0, 'key')).toThrow('Корзина пуста');
  });
  it('validates checkout and expected price without clearing the cart', async () => {
    const account = await signIn();
    const cart = store.setQuantity(account, 'point', 1);
    expect(() => store.createOrder(account, { ...delivery, phone: '123' }, cart.total, 'key')).toThrow(MockError);
    expect(() => store.createOrder(account, delivery, 1, 'key')).toThrow('Стоимость изменилась');
    expect(store.cart(account).count).toBe(1);
  });
  it('creates exactly one durable order for retries and preserves the price snapshot', async () => {
    const account = await signIn();
    const cart = store.setQuantity(account, 'point', 2);
    const order = store.createOrder(account, delivery, cart.total, 'same-key');
    const repeated = store.createOrder(account, delivery, cart.total, 'same-key');
    expect(repeated.id).toBe(order.id);
    expect(store.product('point').stock).toBe(8);
    expect(store.cart(account).count).toBe(0);
    const restored = new MockStore(storage); await restored.initialize();
    expect(restored.order(account, order.id).total).toBe(498000);
    expect(order.number).toBe('FM-1001');
  });
  it('does not disclose another account order', async () => {
    const account = await signIn();
    const cart = store.setQuantity(account, 'point', 1);
    const order = store.createOrder(account, delivery, cart.total, 'key');
    const another = await store.register({ name: 'Другой покупатель', email: 'other@example.com', password: 'Another123' }, 'guest-b');
    expect(() => store.order({ token: another.token, guest: 'guest-b' }, order.id)).toThrow('Заказ не найден');
  });
  it('keeps the cart after a one-shot server error and allows retry', async () => {
    const account = await signIn();
    const cart = store.setQuantity(account, 'quiet-one', 1);
    store.scenario('order-error');
    expect(() => store.createOrder(account, delivery, cart.total, 'key')).toThrow('Не удалось создать заказ');
    expect(store.cart(account).count).toBe(1);
    expect(store.createOrder(account, delivery, cart.total, 'key').total).toBe(cart.total);
  });
  it('reports changed stock and updates the cart before retry', async () => {
    const account = await signIn();
    const cart = store.setQuantity(account, 'quiet-one', 2);
    store.scenario('stock-change');
    expect(() => store.createOrder(account, delivery, cart.total, 'key')).toThrow('Доступное количество изменилось');
    expect(store.cart(account).count).toBe(1);
    expect(store.createOrder(account, delivery, store.cart(account).total, 'key').items[0].quantity).toBe(1);
  });
  it('retains the account cart when the session expires at submission', async () => {
    const account = await signIn();
    const cart = store.setQuantity(account, 'point', 1);
    store.scenario('session-expired');
    expect(() => store.createOrder(account, delivery, cart.total, 'key')).toThrow('Сессия завершилась');
    const loggedInAgain = await signIn();
    expect(store.cart(loggedInAgain).count).toBe(1);
  });
  it('resets fixtures, users, sessions, stock and order numbering', async () => {
    const account = await signIn(); store.setQuantity(account, 'point', 1);
    await store.reset();
    expect(() => store.me(account)).toThrow(MockError);
    expect(store.cart(guest).count).toBe(0);
    expect(store.product('point').stock).toBe(10);
  });
});
