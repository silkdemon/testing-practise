import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../../api/client';
import { useShop } from '../../app/ShopProvider';
import { Field, focusInvalid, validateForm } from '../../components/Field';
import { ProductArt } from '../../components/ui';

export function safeReturnTo(value: string | null) {
  return value === '/checkout' || value === '/cart' || /^\/orders\/[a-zA-Z0-9-]+$/.test(value || '') ? value! : '/catalog';
}
export function AuthPage({ register = false }: { register?: boolean }) {
  const [params] = useSearchParams();
  const destination = safeReturnTo(params.get('returnTo'));
  const { user, authenticate } = useShop();
  const navigate = useNavigate();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  if (user) return <Navigate to={destination} replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = { name: String(data.get('name') || ''), email: String(data.get('email') || '').trim(), password: String(data.get('password') || '') };
    const validation = validateForm(form);
    if (register && input.password !== data.get('confirm')) validation.confirm = 'Пароли не совпадают.';
    setErrors(validation); setError('');
    if (Object.keys(validation).length) { focusInvalid(form, validation); return; }
    lock.current = true; setPending(true);
    try {
      const result = await (register ? api.register(input) : api.login(input));
      authenticate(result); navigate(destination, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.body.fields) { setErrors(error.body.fields); focusInvalid(form, error.body.fields); }
      setError(errorMessage(error));
    } finally { lock.current = false; setPending(false); }
  }
  const alternate = `${register ? '/login' : '/register'}?returnTo=${encodeURIComponent(destination)}`;
  return <div className="fs-auth"><aside className="fs-auth-aside"><div className="fs-kicker">Рады знакомству</div><ProductArt product={{ name: 'Наушники', art: 'headphones', tone: '', stock: 1 }} /><h2>Хорошие вещи<br />остаются с вами.</h2><p className="fs-muted">{destination === '/checkout' ? 'Войдите, чтобы оформить заказ. Всё, что вы выбрали, уже ждёт в корзине.' : 'Войдите в аккаунт, чтобы сохранить свой выбор и оформить заказ.'}</p></aside><form className="fs-auth-form" onSubmit={submit} noValidate aria-busy={pending}><div className="fs-kicker">Ваш аккаунт</div><h1>{register ? 'Создать аккаунт' : 'С возвращением'}</h1><p className="fs-muted">{register ? 'Всего несколько полей — и можно за покупками.' : 'Войдите с помощью email и пароля.'}</p><fieldset disabled={pending}>{register && <Field name="name" label="Имя" autoComplete="name" required minLength={2} maxLength={80} error={errors.name} />}<Field name="email" label="Email" type="email" autoComplete="email" required maxLength={254} error={errors.email} /><Field name="password" label="Пароль" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 8 : undefined} maxLength={128} error={errors.password} hint={register ? 'Не менее 8 символов' : undefined} />{register && <Field name="confirm" label="Повторите пароль" type="password" autoComplete="new-password" required error={errors.confirm} />}<div role="alert" className="fs-error fs-form-error">{error}</div><button className="fs-button fs-primary fs-full" type="submit">{pending ? 'Подождите…' : register ? 'Создать аккаунт' : 'Войти'}</button></fieldset><div className="fs-auth-switch"><span className="fs-muted">{register ? 'Уже есть аккаунт?' : 'Первый раз здесь?'}</span> <Link className="fs-link" to={alternate}>{register ? 'Войти' : 'Зарегистрироваться'}</Link></div></form></div>;
}
