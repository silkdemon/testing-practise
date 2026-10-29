CREATE TABLE users (
 id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (email = lower(btrim(email)))
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE products (
 id text PRIMARY KEY, name text NOT NULL, category text NOT NULL,
 description text NOT NULL, detail text NOT NULL,
 price bigint NOT NULL CHECK (price BETWEEN 0 AND 9007199254740991),
 stock integer NOT NULL CHECK (stock >= 0), art text NOT NULL, tone text NOT NULL,
 badge text NOT NULL DEFAULT '', specs jsonb NOT NULL
);
CREATE TABLE carts (
 id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), guest_token_hash text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((user_id IS NULL) <> (guest_token_hash IS NULL))
);
CREATE UNIQUE INDEX carts_user_idx ON carts(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX carts_guest_idx ON carts(guest_token_hash) WHERE guest_token_hash IS NOT NULL;
CREATE TABLE cart_items (
 cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
 product_id text NOT NULL REFERENCES products(id), quantity integer NOT NULL CHECK(quantity > 0),
 PRIMARY KEY(cart_id, product_id)
);
CREATE SEQUENCE order_numbers START 1001;
CREATE TABLE orders (
 id uuid PRIMARY KEY, number text NOT NULL UNIQUE DEFAULT ('FM-' || nextval('order_numbers')),
 user_id uuid NOT NULL REFERENCES users(id),
 total bigint NOT NULL CHECK (total BETWEEN 0 AND 9007199254740991),
 delivery jsonb NOT NULL, idempotency_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, idempotency_key)
);
CREATE TABLE order_items (
 order_id uuid NOT NULL REFERENCES orders(id), product_id text NOT NULL REFERENCES products(id),
 product_snapshot jsonb NOT NULL, quantity integer NOT NULL CHECK(quantity > 0),
 unit_price bigint NOT NULL CHECK(unit_price BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(order_id, product_id)
);
