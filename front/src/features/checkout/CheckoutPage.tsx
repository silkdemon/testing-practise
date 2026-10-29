import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../../api/client';
import type { CheckoutInput } from '../../api/types';
import { useShop } from '../../app/ShopProvider';
import { Field, focusInvalid, validateForm } from '../../components/Field';
import { EmptyCart } from '../cart/CartPage';
import { OrderSummary } from '../cart/OrderSummary';

interface Draft { delivery: CheckoutInput; key: string }
export function CheckoutPage() {
  const { user, cart, busy, refreshCart, orderCompleted, notify } = useShop();
  const navigate = useNavigate();
  const storageKey = `forma.checkout.${user!.id}`;
  const [draft, setDraft] = useState<Draft>(() => {
    const blank: CheckoutInput = { name: user!.name, email: user!.email, phone: '', city: '', address: '', comment: '' };
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (stored?.delivery && typeof stored.key === 'string') {
        return { key: stored.key, delivery: Object.fromEntries(Object.entries(blank).map(([key, fallback]) => [key, typeof stored.delivery[key] === 'string' ? stored.delivery[key] : fallback])) as unknown as CheckoutInput };
      }
    } catch { /* A malformed draft does not block checkout. */ }
    return { delivery: blank, key: crypto.randomUUID() };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  function change(name: keyof CheckoutInput, value: string) {
    const next = { ...draft, delivery: { ...draft.delivery, [name]: value } };
    setDraft(next); sessionStorage.setItem(storageKey, JSON.stringify(next));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || busy) return;
    const form = event.currentTarget;
    const validation = validateForm(form);
    setErrors(validation); setError('');
    if (Object.keys(validation).length) { focusInvalid(form, validation); return; }
    sessionStorage.setItem(storageKey, JSON.stringify(draft));
    lock.current = true; setPending(true);
    try {
      const order = await api.createOrder(draft.delivery, cart.total, draft.key);
      sessionStorage.removeItem(storageKey); orderCompleted();
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) { navigate('/login?returnTo=%2Fcheckout', { replace: true }); return; }
        if (error.body.fields) { setErrors(error.body.fields); focusInvalid(form, error.body.fields); }
        if (error.status === 409) {
          notify(error.message, 'info');
          try { await refreshCart(); } catch { /* Keep the original conflict visible and the draft intact. */ }
        }
      }
      setError(errorMessage(error));
    } finally { lock.current = false; setPending(false); }
  }
  if (!cart.count) return <EmptyCart />;
  const field = (name: keyof CheckoutInput, label: string, props: { type?: string; autoComplete?: string; minLength?: number; maxLength?: number } = {}) => <Field name={name} label={label} required value={draft.delivery[name]} onChange={event => change(name, event.target.value)} error={errors[name]} {...props} />;
  return <><nav className="fs-steps" aria-label="Этапы заказа"><Link className="fs-link" to="/cart">Корзина</Link><span aria-hidden="true">→</span><span className="fs-current" aria-current="step">Оформление</span><span aria-hidden="true">→</span><span>Подтверждение</span></nav><h1>Почти готово</h1><p className="fs-muted">Осталось указать, кому и куда доставить заказ.</p><div className="fs-columns"><form className="fs-checkout fs-panel" onSubmit={submit} noValidate aria-busy={pending}><fieldset disabled={pending}><h2>Контактные данные</h2>{field('name', 'Имя', { autoComplete: 'name', minLength: 2, maxLength: 80 })}<div className="fs-fields">{field('email', 'Email', { type: 'email', autoComplete: 'email', maxLength: 254 })}{field('phone', 'Телефон', { type: 'tel', autoComplete: 'tel', maxLength: 30 })}</div><h2 className="fs-section-heading">Адрес доставки</h2>{field('city', 'Город', { autoComplete: 'address-level2', maxLength: 100 })}{field('address', 'Улица, дом, квартира', { autoComplete: 'street-address', maxLength: 250 })}<div className="fs-field"><label htmlFor="comment">Комментарий <span className="fs-muted">· необязательно</span></label><textarea id="comment" name="comment" rows={2} maxLength={500} placeholder="Например, как найти вход" value={draft.delivery.comment} onChange={event => change('comment', event.target.value)} /></div><div className="fs-error fs-form-error" role="alert">{error}</div><button className="fs-button fs-primary fs-full" type="submit" disabled={pending || busy} data-testid="place-order">{pending ? 'Оформляем…' : 'Оформить заказ'}</button><p className="fs-note">Реальной оплаты и доставки не будет.</p></fieldset></form><OrderSummary checkout /></div></>;
}
