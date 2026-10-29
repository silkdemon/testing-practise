import { http, HttpResponse } from 'msw/http';
import { delay } from 'msw/utils/delay';
import type { CheckoutInput, LoginInput, RegisterInput } from '../api/types';
import { MockError, MockStore, type Identity, type Scenario } from './store';

const identity = (request: Request): Identity => ({ token: request.headers.get('Authorization')?.replace(/^Bearer /, '') || null, guest: request.headers.get('X-Guest-Id') || '' });

export function createHandlers(store: MockStore, latency = 250) {
  const respond = (work: () => unknown | Promise<unknown>, status = 200) => async () => {
    await delay(latency);
    try { const data = await work(); return status === 204 ? new HttpResponse(null, { status }) : HttpResponse.json(data as Parameters<typeof HttpResponse.json>[0], { status }); }
    catch (error) {
      if (error instanceof MockError) return HttpResponse.json({ code: error.code, message: error.message, fields: error.fields }, { status: error.status });
      if (error instanceof SyntaxError) return HttpResponse.json({ code: 'INVALID_JSON', message: 'Некорректный запрос.' }, { status: 400 });
      return HttpResponse.json({ code: 'MOCK_ERROR', message: 'Не удалось обработать запрос. Проверьте доступность хранилища браузера.' }, { status: 500 });
    }
  };
  return [
    http.get('*/api/products', ({ request }) => respond(() => store.list(new URL(request.url).searchParams))()),
    http.get('*/api/products/:id', ({ params }) => respond(() => store.product(String(params.id)))()),
    http.get('*/api/auth/me', ({ request }) => respond(() => store.me(identity(request)))()),
    http.post('*/api/auth/login', ({ request }) => respond(async () => store.login(await request.json() as LoginInput, identity(request).guest))()),
    http.post('*/api/auth/register', ({ request }) => respond(async () => store.register(await request.json() as RegisterInput, identity(request).guest), 201)()),
    http.post('*/api/auth/logout', ({ request }) => respond(() => store.logout(identity(request)), 204)()),
    http.get('*/api/cart', ({ request }) => respond(() => store.cart(identity(request)))()),
    http.post('*/api/cart/items', ({ request }) => respond(async () => {
      const body = await request.json() as { productId: string; quantity: number };
      return store.setQuantity(identity(request), body.productId, body.quantity, true);
    })()),
    http.patch('*/api/cart/items/:id', ({ request, params }) => respond(async () => {
      const body = await request.json() as { quantity: number };
      return store.setQuantity(identity(request), String(params.id), body.quantity);
    })()),
    http.delete('*/api/cart/items/:id', ({ request, params }) => respond(() => store.setQuantity(identity(request), String(params.id), 0))()),
    http.post('*/api/orders', ({ request }) => respond(async () => {
      const body = await request.json() as { delivery: CheckoutInput; expectedTotal: number };
      return store.createOrder(identity(request), body.delivery, body.expectedTotal, request.headers.get('Idempotency-Key') || '');
    }, 201)()),
    http.get('*/api/orders/:id', ({ request, params }) => respond(() => store.order(identity(request), String(params.id)))()),
    http.post('*/api/__mock/scenario', ({ request }) => respond(async () => {
      const body = await request.json() as { scenario: Scenario }; store.scenario(body.scenario); return { scenario: body.scenario };
    })()),
    http.post('*/api/__mock/reset', () => respond(async () => {
      await store.reset();
      localStorage.removeItem('forma.session'); localStorage.removeItem('forma.guest');
      Object.keys(sessionStorage).filter(key => key.startsWith('forma.checkout.')).forEach(key => sessionStorage.removeItem(key));
      return { reset: true };
    })()),
  ];
}
