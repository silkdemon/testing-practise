import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { createHandlers } from '../src/mocks/handlers';
import { MockStore } from '../src/mocks/store';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(async () => {
  const data = new Map<string, string>();
  const store = new MockStore({ getItem: key => data.get(key) || null, setItem: (key, value) => { data.set(key, value); } });
  await store.initialize();
  server.use(...createHandlers(store, 0));
});
const request = (path: string, method = 'GET', body?: unknown, token?: string) => fetch(`http://forma.test/api${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', 'X-Guest-Id': 'http-test', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

it('supports repeated HTTP login/logout cycles with empty 204 responses and session invalidation', async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const login = await request('/auth/login', 'POST', { email: 'demo@example.com', password: 'Demo12345' });
    expect(login.status).toBe(200);
    const { token } = await login.json() as { token: string };
    expect((await request('/auth/me', 'GET', undefined, token)).status).toBe(200);
    const logout = await request('/auth/logout', 'POST', undefined, token);
    expect(logout.status).toBe(204);
    expect(await logout.text()).toBe('');
    expect((await request('/auth/me', 'GET', undefined, token)).status).toBe(401);
    const guestCart = await request('/cart');
    expect(guestCart.status).toBe(200);
    expect(await guestCart.json()).toMatchObject({ count: 0 });
  }
});

it('returns structured HTTP errors for invalid credentials and missing products', async () => {
  const login = await request('/auth/login', 'POST', { email: 'demo@example.com', password: 'wrong' });
  expect(login.status).toBe(400);
  expect(await login.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  const product = await request('/products/missing');
  expect(product.status).toBe(404);
  expect(await product.json()).toMatchObject({ code: 'NOT_FOUND' });
});
