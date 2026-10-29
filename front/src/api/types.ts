export interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  detail: string;
  /** Integer kopecks. */
  price: number;
  stock: number;
  art: 'headphones' | 'keyboard' | 'speaker' | 'mouse' | 'buds' | 'lamp';
  tone: string;
  badge?: string;
  specs: { label: string; value: string }[];
}
export interface User { id: string; name: string; email: string }
export interface CartItem { product: Product; quantity: number }
export interface Cart { items: CartItem[]; count: number; total: number }
export interface AuthResult { user: User; token: string; cart: Cart; warnings: string[] }
export interface LoginInput { email: string; password: string }
export interface RegisterInput extends LoginInput { name: string }
export interface CheckoutInput {
  name: string; email: string; phone: string; city: string; address: string; comment: string;
}
export interface Order {
  id: string; number: string; userId: string; createdAt: string;
  items: CartItem[]; total: number; delivery: CheckoutInput;
}
export interface ApiErrorBody { message: string; code: string; fields?: Record<string, string> }
export const emptyCart: Cart = { items: [], count: 0, total: 0 };
