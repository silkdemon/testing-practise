import type { InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> { name: string; label: string; error?: string; hint?: string }
export function Field({ name, label, error, hint, ...props }: Props) {
  const descriptions = [hint ? `${name}-hint` : '', error ? `${name}-error` : ''].filter(Boolean).join(' ');
  return <div className="fs-field">
    <label htmlFor={name}>{label}</label>
    <input id={name} name={name} aria-invalid={!!error} aria-describedby={descriptions || undefined} {...props} />
    {hint && <div className="fs-small fs-muted" id={`${name}-hint`}>{hint}</div>}
    {error && <div className="fs-error" id={`${name}-error`} role="alert">{error}</div>}
  </div>;
}
export function validateForm(form: HTMLFormElement): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const input of form.querySelectorAll('input')) {
    if (input.required && !input.value.trim()) errors[input.name] = 'Заполните это поле.';
    else if (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) errors[input.name] = 'Введите email в формате name@example.com.';
    else if (input.minLength > 0 && input.value.trim().length < input.minLength) errors[input.name] = `Минимум ${input.minLength} символов.`;
    else if (input.maxLength > 0 && input.value.length > input.maxLength) errors[input.name] = `Максимум ${input.maxLength} символов.`;
    else if (input.type === 'tel' && (!/^[+\d\s()-]+$/.test(input.value) || input.value.replace(/\D/g, '').length < 10 || input.value.replace(/\D/g, '').length > 15)) errors[input.name] = 'Телефон должен содержать от 10 до 15 цифр.';
  }
  return errors;
}
export function focusInvalid(form: HTMLFormElement, errors: Record<string, string>) {
  const first = Object.keys(errors)[0];
  if (first) (form.elements.namedItem(first) as HTMLInputElement | null)?.focus();
}
