package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"forma/back/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"sort"
	"strings"
	"time"
)

type Store struct{ DB *pgxpool.Pool }
type Queryer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func Products(ctx context.Context, q Queryer, search, category, order string) ([]model.Product, error) {
	rows, err := q.Query(ctx, `SELECT to_jsonb(p) FROM products p ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []model.Product{}
	search = strings.ToLower(strings.TrimSpace(search))
	for rows.Next() {
		var p model.Product
		var b []byte
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(b, &p); err != nil {
			return nil, err
		}
		if (category == "" || p.Category == category) && strings.Contains(strings.ToLower(p.Name), search) {
			result = append(result, p)
		}
	}
	if order == "price-asc" {
		sort.SliceStable(result, func(i, j int) bool { return result[i].Price < result[j].Price })
	}
	if order == "price-desc" {
		sort.SliceStable(result, func(i, j int) bool { return result[i].Price > result[j].Price })
	}
	return result, rows.Err()
}
func Product(ctx context.Context, q Queryer, id string, lock bool) (model.Product, error) {
	query := `SELECT to_jsonb(p) FROM products p WHERE id=$1`
	if lock {
		query += ` FOR UPDATE`
	}
	var b []byte
	var p model.Product
	err := q.QueryRow(ctx, query, id).Scan(&b)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, model.NotFound()
	}
	if err != nil {
		return p, err
	}
	err = json.Unmarshal(b, &p)
	return p, err
}
func FindUser(ctx context.Context, q Queryer, email string) (model.User, string, error) {
	var u model.User
	var hash string
	err := q.QueryRow(ctx, `SELECT id::text,name,email,password_hash FROM users WHERE email=$1`, email).Scan(&u.ID, &u.Name, &u.Email, &hash)
	return u, hash, err
}
func InsertUser(ctx context.Context, q Queryer, u model.User, hash string) error {
	_, err := q.Exec(ctx, `INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)`, u.ID, u.Name, u.Email, hash)
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		e := model.Fail(409, "EMAIL_TAKEN", "Этот email уже зарегистрирован.")
		e.Fields = map[string]string{"email": e.Message}
		return e
	}
	return err
}
func SessionUser(ctx context.Context, q Queryer, token string) (model.User, error) {
	var u model.User
	err := q.QueryRow(ctx, `SELECT u.id::text,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, model.Hash(token)).Scan(&u.ID, &u.Name, &u.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		err = model.Unauthorized()
	}
	return u, err
}
func InsertSession(ctx context.Context, q Queryer, user, token string, expires time.Time) error {
	_, err := q.Exec(ctx, `INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4)`, model.UUID(), user, model.Hash(token), expires)
	return err
}
func DeleteSession(ctx context.Context, q Queryer, token string) error {
	_, err := q.Exec(ctx, `DELETE FROM sessions WHERE token_hash=$1`, model.Hash(token))
	return err
}

// Cart IDs are obtained before any row locks. All writers then lock carts in ID order.
func EnsureCart(ctx context.Context, q Queryer, user, guestHash string) (string, error) {
	var id string
	var err error
	if user != "" {
		_, err = q.Exec(ctx, `INSERT INTO carts(id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, model.UUID(), user)
		if err != nil {
			return "", err
		}
		err = q.QueryRow(ctx, `SELECT id::text FROM carts WHERE user_id=$1`, user).Scan(&id)
	} else {
		_, err = q.Exec(ctx, `INSERT INTO carts(id,guest_token_hash) VALUES($1,$2) ON CONFLICT DO NOTHING`, model.UUID(), guestHash)
		if err != nil {
			return "", err
		}
		err = q.QueryRow(ctx, `SELECT id::text FROM carts WHERE guest_token_hash=$1`, guestHash).Scan(&id)
	}
	return id, err
}
func LockCarts(ctx context.Context, q Queryer, ids ...string) error {
	sort.Strings(ids)
	for _, id := range ids {
		var locked string
		if err := q.QueryRow(ctx, `SELECT id::text FROM carts WHERE id=$1 FOR UPDATE`, id).Scan(&locked); err != nil {
			return err
		}
	}
	return nil
}
func LockProducts(ctx context.Context, q Queryer, carts ...string) error {
	rows, err := q.Query(ctx, `SELECT p.id FROM products p WHERE p.id IN (SELECT product_id FROM cart_items WHERE cart_id::text=ANY($1::text[])) ORDER BY p.id FOR UPDATE`, carts)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return err
		}
	}
	return rows.Err()
}
func Cart(ctx context.Context, q Queryer, id string) (model.Cart, error) {
	c := model.EmptyCart()
	rows, err := q.Query(ctx, `SELECT to_jsonb(p),i.quantity FROM cart_items i JOIN products p ON p.id=i.product_id WHERE i.cart_id=$1 ORDER BY p.id`, id)
	if err != nil {
		return c, err
	}
	defer rows.Close()
	for rows.Next() {
		var i model.CartItem
		var b []byte
		if err = rows.Scan(&b, &i.Quantity); err != nil {
			return c, err
		}
		if err = json.Unmarshal(b, &i.Product); err != nil {
			return c, err
		}
		if err = c.Add(i); err != nil {
			return c, err
		}
	}
	return c, rows.Err()
}
func SetQuantity(ctx context.Context, q Queryer, cart, product string, quantity int64) error {
	var err error
	if quantity == 0 {
		_, err = q.Exec(ctx, `DELETE FROM cart_items WHERE cart_id=$1 AND product_id=$2`, cart, product)
	} else {
		_, err = q.Exec(ctx, `INSERT INTO cart_items(cart_id,product_id,quantity) VALUES($1,$2,$3) ON CONFLICT(cart_id,product_id) DO UPDATE SET quantity=excluded.quantity`, cart, product, quantity)
	}
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE carts SET updated_at=now() WHERE id=$1`, cart)
	return err
}
func ClearCart(ctx context.Context, q Queryer, id string) error {
	_, err := q.Exec(ctx, `DELETE FROM cart_items WHERE cart_id=$1`, id)
	return err
}
func OrderByKey(ctx context.Context, q Queryer, user, key string) (model.Order, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM orders WHERE user_id=$1 AND idempotency_key=$2`, user, key).Scan(&id)
	if err != nil {
		return model.Order{}, err
	}
	return Order(ctx, q, user, id)
}
func Order(ctx context.Context, q Queryer, user, id string) (model.Order, error) {
	var o model.Order
	var delivery []byte
	err := q.QueryRow(ctx, `SELECT id::text,number,user_id::text,created_at,total,delivery FROM orders WHERE id=$1 AND user_id=$2`, id, user).Scan(&o.ID, &o.Number, &o.UserID, &o.CreatedAt, &o.Total, &delivery)
	if errors.Is(err, pgx.ErrNoRows) {
		return o, model.NotFound()
	}
	if err != nil {
		return o, err
	}
	if err = json.Unmarshal(delivery, &o.Delivery); err != nil {
		return o, err
	}
	o.Items = []model.CartItem{}
	rows, err := q.Query(ctx, `SELECT product_snapshot,quantity FROM order_items WHERE order_id=$1 ORDER BY product_id`, id)
	if err != nil {
		return o, err
	}
	defer rows.Close()
	for rows.Next() {
		var item model.CartItem
		var b []byte
		if err = rows.Scan(&b, &item.Quantity); err != nil {
			return o, err
		}
		if err = json.Unmarshal(b, &item.Product); err != nil {
			return o, err
		}
		o.Items = append(o.Items, item)
	}
	return o, rows.Err()
}
func InsertOrder(ctx context.Context, q Queryer, user, key string, cart model.Cart, d model.Delivery) (model.Order, error) {
	o := model.Order{ID: model.UUID(), UserID: user, Items: cart.Items, Total: cart.Total, Delivery: d}
	delivery, err := json.Marshal(d)
	if err != nil {
		return o, err
	}
	err = q.QueryRow(ctx, `INSERT INTO orders(id,user_id,total,delivery,idempotency_key) VALUES($1,$2,$3,$4,$5) RETURNING number,created_at`, o.ID, user, cart.Total, delivery, key).Scan(&o.Number, &o.CreatedAt)
	if err != nil {
		return o, err
	}
	for _, i := range cart.Items {
		b, err := json.Marshal(i.Product)
		if err != nil {
			return o, err
		}
		if _, err = q.Exec(ctx, `INSERT INTO order_items(order_id,product_id,product_snapshot,quantity,unit_price) VALUES($1,$2,$3,$4,$5)`, o.ID, i.Product.ID, b, i.Quantity, i.Product.Price); err != nil {
			return o, err
		}
		if _, err = q.Exec(ctx, `UPDATE products SET stock=stock-$2 WHERE id=$1`, i.Product.ID, i.Quantity); err != nil {
			return o, err
		}
	}
	return o, nil
}
