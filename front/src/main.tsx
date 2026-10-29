import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/shop.css';

async function start() {
  // Explicit false switches to the real API; mock handlers never enter components.
  if (import.meta.env.VITE_API_MOCKING !== 'false') {
    const { startMocks } = await import('./mocks/browser');
    await startMocks();
  } else if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter(registration => registration.active?.scriptURL.endsWith('/mockServiceWorker.js')).map(registration => registration.unregister()));
  }
  createRoot(document.getElementById('root')!).render(<App />);
}
start().catch(() => {
  createRoot(document.getElementById('root')!).render(<div id="forma-shop"><main className="fs-main fs-empty"><h1>Не удалось открыть магазин</h1><p>Для учебного API нужен доступ к хранилищу браузера и Service Worker. Откройте сайт через localhost или HTTPS и попробуйте ещё раз.</p><button className="fs-button fs-primary" onClick={() => location.reload()}>Перезагрузить</button></main></div>);
});
