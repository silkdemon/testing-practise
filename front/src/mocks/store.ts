import type { AuthResult, Cart, CheckoutInput, LoginInput, Order, Product, RegisterInput, User } from '../api/types';
import { products as seedProducts } from './products';

export const databaseKey = 'forma.mock-db.v1';
export type Scenario = 'normal' | 'order-error' | 'stock-change' | 'session-expired';
type SavedUser = User & { salt: string; passwordHash: string };
type Quantities = Record<string, number>;
type Session = { userId: string; expiresAt: number };
type StoredOrder = Order & { idempotencyKey: string };
interface Database {
  version: 1; products: Product[]; users: SavedUser[];
  carts: Record<string, Quantities>; sessions: Record<string, Session>;
  orders: StoredOrder[]; nextOrder: number; scenario: Scenario;
}
export interface Identity { token: string | null; guest: string }
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

export class MockError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) { super(message); }
}
function invalid(fields: Record<string, string>): never { throw new MockError(422, 'VALIDATION_ERROR', 'Проверьте заполненные поля.', fields); }
const normalizedEmail = (value: string) => value.trim().toLowerCase();
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
async function digest(password: string, salt: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('');
}
const publicUser = ({ id, name, email }: SavedUser): User => ({ id, name, email });
function cartView(db: Database, quantities: Quantities): Cart {
  const items = Object.entries(quantities).flatMap(([id, quantity]) => {
    const product = db.products.find(p => p.id === id);
    return product && quantity > 0 ? [{ product: structuredClone(product), quantity }] : [];
  });
  return { items, count: items.reduce((sum, i) => sum + i.quantity, 0), total: items.reduce((sum, i) => sum + i.quantity * i.product.price, 0) };
}

/** Browser-local fake server. No application component imports this store. */
export class MockStore {
  constructor(private storage: StorageLike) {}

  async initialize() {
    const saved = this.storage.getItem(databaseKey);
    if (saved) {
      try { if (JSON.parse(saved).version === 1) return; } catch { /* Replace malformed mock data. */ }
    }
    await this.reset();
  }
  async reset() {
    const salt = 'forma-public-demo-fixture';
    const passwordHash = await digest('Demo12345', salt);
    this.write({ version: 1, products: structuredClone(seedProducts), users: [{ id: 'demo', name: 'Покупатель', email: 'demo@example.com', salt, passwordHash }], carts: {}, sessions: {}, orders: [], nextOrder: 1001, scenario: 'normal' });
  }
  private read(): Database { return JSON.parse(this.storage.getItem(databaseKey)!); }
  private write(db: Database) { this.storage.setItem(databaseKey, JSON.stringify(db)); }
  private user(db: Database, identity: Identity): SavedUser {
    const session = identity.token ? db.sessions[identity.token] : null;
    const user = session && session.expiresAt > Date.now() ? db.users.find(u => u.id === session.userId) : null;
    if (!user) throw new MockError(401, 'UNAUTHORIZED', 'Сессия завершилась. Войдите ещё раз — корзина сохранена.');
    return user;
  }
  private owner(db: Database, identity: Identity) {
    if (identity.token) return `user:${this.user(db, identity).id}`;
    if (!identity.guest) throw new MockError(400, 'GUEST_REQUIRED', 'Не удалось определить гостевую корзину.');
    return `guest:${identity.guest}`;
  }
  list(query: URLSearchParams) {
    const q = (query.get('q') || '').trim().toLowerCase();
    const category = query.get('category');
    const items = this.read().products.filter(p => (!category || p.category === category) && p.name.toLowerCase().includes(q));
    if (query.get('sort') === 'price-asc') items.sort((a, b) => a.price - b.price);
    if (query.get('sort') === 'price-desc') items.sort((a, b) => b.price - a.price);
    return items;
  }
  product(id: string) {
    const product = this.read().products.find(p => p.id === id);
    if (!product) throw new MockError(404, 'NOT_FOUND', 'Товар не найден.');
    return product;
  }
  me(identity: Identity) { return publicUser(this.user(this.read(), identity)); }
  private authenticate(db: Database, user: SavedUser, guest: string): AuthResult {
    const accountKey = `user:${user.id}`, guestKey = `guest:${guest}`;
    const cart = db.carts[accountKey] || {};
    const warnings: string[] = [];
    for (const [id, quantity] of Object.entries(db.carts[guestKey] || {})) cart[id] = (cart[id] || 0) + quantity;
    for (const [id, quantity] of Object.entries(cart)) {
      const product = db.products.find(p => p.id === id);
      const stock = product?.stock || 0;
      if (quantity > stock) {
        warnings.push(`${product?.name || 'Товар'}: количество уменьшено до ${stock} по доступному остатку.`);
        if (stock) cart[id] = stock; else delete cart[id];
      }
    }
    db.carts[accountKey] = cart;
    delete db.carts[guestKey];
    const token = crypto.randomUUID();
    db.sessions[token] = { userId: user.id, expiresAt: Date.now() + 86400000 };
    this.write(db);
    return { user: publicUser(user), token, cart: cartView(db, cart), warnings };
  }
  async login(input: LoginInput, guest: string) {
    if (typeof input.email !== 'string' || typeof input.password !== 'string') invalid({ email: 'Укажите email и пароль.' });
    const user = this.read().users.find(u => u.email === normalizedEmail(input.email));
    if (!user || await digest(input.password, user.salt) !== user.passwordHash) throw new MockError(400, 'INVALID_CREDENTIALS', 'Неверный email или пароль.');
    return this.authenticate(this.read(), user, guest);
  }
  async register(input: RegisterInput, guest: string) {
    const fields: Record<string, string> = {};
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.length > 80) fields.name = 'Имя должно содержать от 2 до 80 символов.';
    if (typeof input.email !== 'string' || !validEmail(input.email.trim())) fields.email = 'Введите корректный email.';
    if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128) fields.password = 'Пароль должен содержать от 8 до 128 символов.';
    if (Object.keys(fields).length) invalid(fields);
    const salt = crypto.randomUUID();
    const passwordHash = await digest(input.password, salt);
    // Read again after hashing so concurrent registrations cannot overwrite each other.
    const db = this.read();
    if (db.users.some(u => u.email === normalizedEmail(input.email))) throw new MockError(409, 'EMAIL_TAKEN', 'Этот email уже зарегистрирован.', { email: 'Этот email уже зарегистрирован.' });
    const user: SavedUser = { id: crypto.randomUUID(), name: input.name.trim(), email: normalizedEmail(input.email), salt, passwordHash };
    db.users.push(user);
    return this.authenticate(db, user, guest);
  }
  logout(identity: Identity) {
    const db = this.read();
    if (identity.token) delete db.sessions[identity.token];
    this.write(db);
  }
  cart(identity: Identity) {
    const db = this.read();
    return cartView(db, db.carts[this.owner(db, identity)] || {});
  }
  setQuantity(identity: Identity, id: string, quantity: number, add = false) {
    const db = this.read(), owner = this.owner(db, identity);
    const product = db.products.find(p => p.id === id);
    if (!product) throw new MockError(404, 'NOT_FOUND', 'Товар не найден.');
    if (!Number.isInteger(quantity) || quantity < 0) invalid({ quantity: 'Количество должно быть целым неотрицательным числом.' });
    const cart = db.carts[owner] || {};
    const next = add ? (cart[id] || 0) + quantity : quantity;
    if (next > product.stock) throw new MockError(409, 'STOCK_LIMIT', product.stock ? `Доступно только ${product.stock} шт. товара «${product.name}».` : 'Товара больше нет в наличии.');
    if (next) cart[id] = next; else delete cart[id];
    db.carts[owner] = cart;
    this.write(db);
    return cartView(db, cart);
  }
  scenario(value: Scenario) {
    if (!['normal', 'order-error', 'stock-change', 'session-expired'].includes(value)) invalid({ scenario: 'Неизвестный сценарий.' });
    const db = this.read(); db.scenario = value; this.write(db);
  }
  createOrder(identity: Identity, delivery: CheckoutInput, expectedTotal: number, key: string) {
    const db = this.read();
    const user = this.user(db, identity);
    if (!key) throw new MockError(400, 'IDEMPOTENCY_REQUIRED', 'Отсутствует ключ создания заказа.');
    const existing = db.orders.find(o => o.userId === user.id && o.idempotencyKey === key);
    if (existing) return this.publicOrder(existing);
    const owner = `user:${user.id}`;
    const cart = db.carts[owner] || {};
    if (!Object.keys(cart).length) throw new MockError(409, 'EMPTY_CART', 'Корзина пуста. Добавьте товары перед оформлением.');
    const fields: Record<string, string> = {};
    for (const field of ['name', 'email', 'phone', 'city', 'address'] as const) {
      if (typeof delivery?.[field] !== 'string' || !delivery[field].trim()) fields[field] = 'Заполните это поле.';
    }
    if (typeof delivery?.email === 'string' && !validEmail(delivery.email.trim())) fields.email = 'Введите корректный email.';
    if (typeof delivery?.phone === 'string' && !/^[+\d\s()-]+$/.test(delivery.phone)) fields.phone = 'Введите корректный телефон.';
    const digits = typeof delivery?.phone === 'string' ? delivery.phone.replace(/\D/g, '').length : 0;
    if (digits < 10 || digits > 15) fields.phone = 'Телефон должен содержать от 10 до 15 цифр.';
    if (Object.keys(fields).length) invalid(fields);
    const scenario = db.scenario;
    db.scenario = 'normal';
    if (scenario === 'order-error') { this.write(db); throw new MockError(503, 'ORDER_UNAVAILABLE', 'Не удалось создать заказ. Данные сохранены — попробуйте ещё раз.'); }
    if (scenario === 'session-expired') { delete db.sessions[identity.token!]; this.write(db); throw new MockError(401, 'UNAUTHORIZED', 'Сессия завершилась. Войдите ещё раз — корзина сохранена.'); }
    if (scenario === 'stock-change') {
      const id = Object.keys(cart)[0];
      const product = db.products.find(p => p.id === id)!;
      product.stock = Math.max(0, cart[id] - 1);
    }
    let changed = false;
    for (const [id, quantity] of Object.entries(cart)) {
      const stock = db.products.find(p => p.id === id)?.stock || 0;
      if (quantity > stock) { changed = true; if (stock) cart[id] = stock; else delete cart[id]; }
    }
    if (changed) { db.carts[owner] = cart; this.write(db); throw new MockError(409, 'STOCK_CHANGED', 'Доступное количество изменилось. Корзина обновлена; проверьте состав заказа.'); }
    const view = cartView(db, cart);
    if (expectedTotal !== view.total) throw new MockError(409, 'PRICE_CHANGED', 'Стоимость изменилась. Проверьте обновлённую сумму.');
    const order: StoredOrder = { id: crypto.randomUUID(), number: `FM-${db.nextOrder++}`, userId: user.id, createdAt: new Date().toISOString(), items: view.items, total: view.total, delivery: structuredClone(delivery), idempotencyKey: key };
    for (const item of view.items) db.products.find(p => p.id === item.product.id)!.stock -= item.quantity;
    db.orders.push(order); db.carts[owner] = {};
    this.write(db);
    return this.publicOrder(order);
  }
  private publicOrder({ idempotencyKey: _, ...order }: StoredOrder): Order { return order; }
  order(identity: Identity, id: string) {
    const db = this.read(), user = this.user(db, identity);
    const order = db.orders.find(o => o.id === id && o.userId === user.id);
    if (!order) throw new MockError(404, 'NOT_FOUND', 'Заказ не найден.');
    return this.publicOrder(order);
  }
}
