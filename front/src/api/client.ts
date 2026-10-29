import type { ApiErrorBody, AuthResult, Cart, CheckoutInput, LoginInput, Order, Product, RegisterInput, User } from './types';

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const tokenKey = 'forma.session';
const guestKey = 'forma.guest';

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) { super(body.message); }
}
export const getToken = () => localStorage.getItem(tokenKey);
export function setToken(token: string | null) {
  if (token) localStorage.setItem(tokenKey, token);
  else localStorage.removeItem(tokenKey);
}
function guestId() {
  let id = localStorage.getItem(guestKey);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(guestKey, id); }
  return id;
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Guest-Id', guestId());
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try { response = await fetch(`${baseUrl}${path}`, { ...options, headers, credentials: 'include' }); }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: 'Не удалось связаться с магазином. Проверьте соединение и попробуйте ещё раз.' });
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ code: 'HTTP_ERROR', message: 'Что-то пошло не так. Попробуйте ещё раз.' }));
    if (response.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event('forma:session-expired'));
    }
    throw new ApiError(response.status, body);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export const api = {
  products: (query = '', signal?: AbortSignal) => request<Product[]>(`/products${query ? `?${query}` : ''}`, { signal }),
  product: (id: string, signal?: AbortSignal) => request<Product>(`/products/${encodeURIComponent(id)}`, { signal }),
  me: () => request<User>('/auth/me'),
  login: (data: LoginInput) => request<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  register: (data: RegisterInput) => request<AuthResult>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  cart: () => request<Cart>('/cart'),
  add: (productId: string) => request<Cart>('/cart/items', { method: 'POST', body: JSON.stringify({ productId, quantity: 1 }) }),
  quantity: (productId: string, quantity: number) => request<Cart>(`/cart/items/${productId}`, { method: 'PATCH', body: JSON.stringify({ quantity }) }),
  remove: (productId: string) => request<Cart>(`/cart/items/${productId}`, { method: 'DELETE' }),
  order: (id: string, signal?: AbortSignal) => request<Order>(`/orders/${encodeURIComponent(id)}`, { signal }),
  createOrder: (delivery: CheckoutInput, expectedTotal: number, key: string) => request<Order>('/orders', {
    method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ delivery, expectedTotal }),
  }),
};
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Что-то пошло не так. Попробуйте ещё раз.';
