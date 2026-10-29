import { setupWorker } from 'msw/browser';
import { createHandlers } from './handlers';
import { MockStore } from './store';

export async function startMocks() {
  const store = new MockStore(localStorage);
  await store.initialize();
  const requestedDelay = Number(import.meta.env.VITE_MOCK_DELAY ?? 250);
  const worker = setupWorker(...createHandlers(store, Number.isFinite(requestedDelay) ? Math.max(0, requestedDelay) : 250));
  await worker.start({ quiet: true, onUnhandledFrame: 'bypass' });
}
