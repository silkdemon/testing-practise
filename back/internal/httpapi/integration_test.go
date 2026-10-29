package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"forma/back/internal/httpapi"
	"forma/back/internal/model"
	"forma/back/internal/postgres"
	"forma/back/internal/service"
	"forma/back/migrations"
	"forma/back/seed"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

type testClient struct{ base, guest, token string }
type reply struct {
	status int
	body   []byte
	header http.Header
	err    error
}

func (c testClient) request(method, path string, body any, key string) reply {
	var b []byte
	var err error
	if body != nil {
		b, err = json.Marshal(body)
		if err != nil {
			return reply{err: err}
		}
	}
	req, err := http.NewRequest(method, c.base+path, bytes.NewReader(b))
	if err != nil {
		return reply{err: err}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Guest-Id", c.guest)
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return reply{err: err}
	}
	defer resp.Body.Close()
	b, err = io.ReadAll(resp.Body)
	return reply{resp.StatusCode, b, resp.Header, err}
}
func expect(t *testing.T, r reply, status int) {
	t.Helper()
	if r.err != nil {
		t.Fatal(r.err)
	}
	if r.status != status {
		t.Fatalf("status %d, want %d: %s", r.status, status, r.body)
	}
}
func decode[T any](t *testing.T, r reply) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(r.body, &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func code(t *testing.T, r reply, want string) {
	t.Helper()
	e := decode[model.Error](t, r)
	if e.Code != want {
		t.Fatalf("code %s, want %s", e.Code, want)
	}
}
func register(t *testing.T, c *testClient, email string) model.AuthResult {
	t.Helper()
	r := c.request("POST", "/api/auth/register", model.Credentials{Name: "Тестовый покупатель", Email: email, Password: "Password123"}, "")
	expect(t, r, 201)
	a := decode[model.AuthResult](t, r)
	c.token = a.Token
	return a
}
func add(t *testing.T, c testClient, id string, qty int64) model.Cart {
	t.Helper()
	r := c.request("POST", "/api/cart/items", map[string]any{"productId": id, "quantity": qty}, "")
	expect(t, r, 200)
	return decode[model.Cart](t, r)
}
func cart(t *testing.T, c testClient) model.Cart {
	t.Helper()
	r := c.request("GET", "/api/cart", nil, "")
	expect(t, r, 200)
	return decode[model.Cart](t, r)
}
func orderBody(total int64) any {
	return map[string]any{"expectedTotal": total, "delivery": model.Delivery{Name: "Тестовый покупатель", Email: "test@example.com", Phone: "+7 (900) 000-00-00", City: "Тестовый город", Address: "Тестовая улица, 1", Comment: "Учебный заказ"}}
}

func TestIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to a disposable database ending in _test")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(cfg.ConnConfig.Database, "_test") {
		t.Fatal("refusing to reset a database without _test suffix")
	}
	ctx := context.Background()
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	shop := &service.Shop{Store: &postgres.Store{DB: db}, SessionTTL: 24 * time.Hour}
	server := httptest.NewServer(httpapi.New(shop, "http://127.0.0.1:5173", log))
	defer server.Close()
	client := func() testClient { return testClient{base: server.URL, guest: model.UUID()} }
	sql := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	reset := func() {
		sql(`TRUNCATE order_items,orders,cart_items,carts,sessions,users,products; ALTER SEQUENCE order_numbers RESTART WITH 1001`)
		if err := seed.Apply(ctx, db); err != nil {
			t.Fatal(err)
		}
	}
	count := func(query string, args ...any) int64 {
		t.Helper()
		var n int64
		if err := db.QueryRow(ctx, query, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	t.Run("register_and_validation", func(t *testing.T) {
		reset()
		c := client()
		a := register(t, &c, "  BUYER@Example.com  ")
		if a.User.Email != "buyer@example.com" || a.Cart.Items == nil || a.Warnings == nil {
			t.Fatal("unexpected auth result")
		}
		expect(t, c.request("GET", "/api/auth/me", nil, ""), 200)
		other := client()
		r := other.request("POST", "/api/auth/register", model.Credentials{Name: "Другой покупатель", Email: "buyer@example.com", Password: "Password123"}, "")
		expect(t, r, 409)
		code(t, r, "EMAIL_TAKEN")
		r = other.request("POST", "/api/auth/login", model.Credentials{Email: a.User.Email, Password: "Wrong123"}, "")
		expect(t, r, 400)
		code(t, r, "INVALID_CREDENTIALS")
		r = other.request("POST", "/api/auth/register", model.Credentials{Name: "X", Email: "bad", Password: "short"}, "")
		expect(t, r, 422)
		var hash string
		db.QueryRow(ctx, `SELECT password_hash FROM users WHERE id=$1`, a.User.ID).Scan(&hash)
		if !strings.HasPrefix(hash, "$argon2id$") {
			t.Fatal("password was not hashed")
		}
		if count(`SELECT count(*) FROM sessions WHERE token_hash=$1`, a.Token) != 0 {
			t.Fatal("raw session token stored")
		}
	})
	t.Run("parallel_registration_unique_email", func(t *testing.T) {
		reset()
		var rs [2]reply
		var wg sync.WaitGroup
		for j := range rs {
			wg.Add(1)
			go func(j int) {
				defer wg.Done()
				rs[j] = client().request("POST", "/api/auth/register", model.Credentials{Name: "Покупатель", Email: "same@example.com", Password: "Password123"}, "")
			}(j)
		}
		wg.Wait()
		if !((rs[0].status == 201 && rs[1].status == 409) || (rs[1].status == 201 && rs[0].status == 409)) {
			t.Fatalf("unexpected results: %+v", rs)
		}
		if count(`SELECT count(*) FROM users WHERE email='same@example.com'`) != 1 {
			t.Fatal("duplicate users")
		}
	})
	t.Run("guest_cart_persists_new_service_connection", func(t *testing.T) {
		reset()
		c := client()
		add(t, c, "quiet-one", 2)
		fresh, err := pgxpool.New(ctx, dsn)
		if err != nil {
			t.Fatal(err)
		}
		defer fresh.Close()
		srv := httptest.NewServer(httpapi.New(&service.Shop{Store: &postgres.Store{DB: fresh}, SessionTTL: time.Hour}, "http://127.0.0.1:5173", log))
		defer srv.Close()
		c.base = srv.URL
		if got := cart(t, c); got.Count != 2 || got.Total != 1798000 {
			t.Fatalf("cart lost: %+v", got)
		}
		c.token = "invalid"
		r := c.request("GET", "/api/cart", nil, "")
		expect(t, r, 401)
		code(t, r, "UNAUTHORIZED")
		c.token = ""
		c.guest = "invalid"
		expect(t, c.request("GET", "/api/cart", nil, ""), 400)
	})
	t.Run("merge_once_under_concurrent_login", func(t *testing.T) {
		reset()
		c := client()
		add(t, c, "quiet-one", 2)
		register(t, &c, "merge@example.com")
		c.token = ""
		add(t, c, "quiet-one", 3)
		var rs [2]reply
		var wg sync.WaitGroup
		for j := range rs {
			wg.Add(1)
			go func(j int) {
				defer wg.Done()
				rs[j] = c.request("POST", "/api/auth/login", model.Credentials{Email: "merge@example.com", Password: "Password123"}, "")
			}(j)
		}
		wg.Wait()
		for _, r := range rs {
			expect(t, r, 200)
			a := decode[model.AuthResult](t, r)
			if a.Cart.Count != 5 {
				t.Fatalf("guest cart merged twice: %+v", a.Cart)
			}
			c.token = a.Token
		}
		expect(t, c.request("POST", "/api/auth/logout", nil, ""), 204)
		expect(t, c.request("GET", "/api/auth/me", nil, ""), 401)
		c.token = ""
		if cart(t, c).Count != 0 {
			t.Fatal("guest cart not cleared")
		}
		r := c.request("POST", "/api/auth/login", model.Credentials{Email: "merge@example.com", Password: "Password123"}, "")
		expect(t, r, 200)
		a := decode[model.AuthResult](t, r)
		if a.Cart.Count != 5 {
			t.Fatal("account cart lost")
		}
	})
	t.Run("merge_caps_stock_with_warning", func(t *testing.T) {
		reset()
		c := client()
		add(t, c, "quiet-one", 6)
		register(t, &c, "cap@example.com")
		c.token = ""
		add(t, c, "quiet-one", 6)
		r := c.request("POST", "/api/auth/login", model.Credentials{Email: "cap@example.com", Password: "Password123"}, "")
		expect(t, r, 200)
		a := decode[model.AuthResult](t, r)
		if a.Cart.Count != 8 || len(a.Warnings) != 1 {
			t.Fatal("stock cap/warning missing")
		}
	})
	t.Run("cart_changes_and_parallel_additions", func(t *testing.T) {
		reset()
		c := client()
		var rs [2]reply
		var wg sync.WaitGroup
		for j, id := range []string{"quiet-one", "point"} {
			wg.Add(1)
			go func(j int, id string) {
				defer wg.Done()
				rs[j] = c.request("POST", "/api/cart/items", map[string]any{"productId": id, "quantity": 1}, "")
			}(j, id)
		}
		wg.Wait()
		for _, r := range rs {
			expect(t, r, 200)
		}
		if cart(t, c).Count != 2 {
			t.Fatal("concurrent cart update lost")
		}
		expect(t, c.request("PATCH", "/api/cart/items/point", map[string]any{"quantity": 0}, ""), 200)
		expect(t, c.request("PATCH", "/api/cart/items/quiet-one", map[string]any{"quantity": 1.5}, ""), 422)
		expect(t, c.request("PATCH", "/api/cart/items/quiet-one", map[string]any{"quantity": -1}, ""), 422)
		r := c.request("PATCH", "/api/cart/items/quiet-one", map[string]any{"quantity": 9}, "")
		expect(t, r, 409)
		code(t, r, "STOCK_LIMIT")
		expect(t, c.request("DELETE", "/api/cart/items/quiet-one", nil, ""), 200)
		if cart(t, c).Count != 0 {
			t.Fatal("delete failed")
		}
	})
	t.Run("purchase_idempotency_snapshot_and_ownership", func(t *testing.T) {
		reset()
		c := client()
		register(t, &c, "order@example.com")
		view := add(t, c, "quiet-one", 2)
		key := model.UUID()
		var rs [2]reply
		var wg sync.WaitGroup
		for j := range rs {
			wg.Add(1)
			go func(j int) { defer wg.Done(); rs[j] = c.request("POST", "/api/orders", orderBody(view.Total), key) }(j)
		}
		wg.Wait()
		for _, r := range rs {
			expect(t, r, 201)
		}
		o := decode[model.Order](t, rs[0])
		if o.ID != decode[model.Order](t, rs[1]).ID {
			t.Fatal("duplicate orders")
		}
		if cart(t, c).Count != 0 {
			t.Fatal("cart not cleared")
		}
		if count(`SELECT stock FROM products WHERE id='quiet-one'`) != 6 || count(`SELECT count(*) FROM orders`) != 1 {
			t.Fatal("wrong stock/order count")
		}
		r := c.request("POST", "/api/orders", orderBody(view.Total), key)
		expect(t, r, 201)
		if decode[model.Order](t, r).ID != o.ID {
			t.Fatal("retry lost")
		}
		sql(`UPDATE products SET price=42,name='Changed',specs='[]' WHERE id='quiet-one'`)
		r = c.request("GET", "/api/orders/"+o.ID, nil, "")
		expect(t, r, 200)
		saved := decode[model.Order](t, r)
		if saved.Items[0].Product.Price != 899000 || saved.Items[0].Product.Name == "Changed" || saved.Delivery.City != "Тестовый город" {
			t.Fatal("snapshot changed")
		}
		stranger := client()
		register(t, &stranger, "other@example.com")
		expect(t, stranger.request("GET", "/api/orders/"+o.ID, nil, ""), 404)
		expect(t, stranger.request("GET", "/api/orders/not-uuid", nil, ""), 404)
		sql(`UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1`, model.Hash(c.token))
		expect(t, c.request("GET", "/api/orders/"+o.ID, nil, ""), 401)
	})
	t.Run("last_unit_two_buyers", func(t *testing.T) {
		reset()
		sql(`UPDATE products SET stock=1 WHERE id='point'`)
		cs := []testClient{client(), client()}
		for j := range cs {
			register(t, &cs[j], fmt.Sprintf("race%d@example.com", j))
			add(t, cs[j], "point", 1)
		}
		var rs [2]reply
		var wg sync.WaitGroup
		for j := range rs {
			wg.Add(1)
			go func(j int) {
				defer wg.Done()
				rs[j] = cs[j].request("POST", "/api/orders", orderBody(249000), model.UUID())
			}(j)
		}
		wg.Wait()
		success, conflict := 0, 0
		for _, r := range rs {
			if r.status == 201 {
				success++
			} else {
				expect(t, r, 409)
				code(t, r, "STOCK_CHANGED")
				conflict++
			}
		}
		if success != 1 || conflict != 1 || count(`SELECT stock FROM products WHERE id='point'`) != 0 || count(`SELECT count(*) FROM orders`) != 1 {
			t.Fatal("oversell")
		}
	})
	t.Run("price_stock_conflicts_do_not_consume_key", func(t *testing.T) {
		reset()
		c := client()
		register(t, &c, "conflict@example.com")
		view := add(t, c, "point", 3)
		key := model.UUID()
		sql(`UPDATE products SET price=250000 WHERE id='point'`)
		r := c.request("POST", "/api/orders", orderBody(view.Total), key)
		expect(t, r, 409)
		code(t, r, "PRICE_CHANGED")
		if count(`SELECT count(*) FROM orders`) != 0 || cart(t, c).Count != 3 {
			t.Fatal("price conflict mutated purchase")
		}
		sql(`UPDATE products SET stock=2 WHERE id='point'`)
		r = c.request("POST", "/api/orders", orderBody(750000), key)
		expect(t, r, 409)
		code(t, r, "STOCK_CHANGED")
		view = cart(t, c)
		if view.Count != 2 || view.Total != 500000 {
			t.Fatal("cart not normalized")
		}
		expect(t, c.request("POST", "/api/orders", orderBody(view.Total), key), 201)
	})
	t.Run("transaction_rolls_back_after_stock_update", func(t *testing.T) {
		reset()
		c := client()
		register(t, &c, "rollback@example.com")
		view := add(t, c, "point", 2)
		key := model.UUID()
		sql(`CREATE FUNCTION fail_cart_clear() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected rollback test'; END $$; CREATE TRIGGER fail_clear BEFORE DELETE ON cart_items FOR EACH ROW EXECUTE FUNCTION fail_cart_clear()`)
		defer sql(`DROP TRIGGER IF EXISTS fail_clear ON cart_items; DROP FUNCTION IF EXISTS fail_cart_clear()`)
		r := c.request("POST", "/api/orders", orderBody(view.Total), key)
		expect(t, r, 500)
		code(t, r, "INTERNAL_ERROR")
		if strings.Contains(string(r.body), "injected") {
			t.Fatal("SQL detail leaked")
		}
		if count(`SELECT count(*) FROM orders`) != 0 || count(`SELECT stock FROM products WHERE id='point'`) != 10 || cart(t, c).Count != 2 {
			t.Fatal("partial transaction committed")
		}
		sql(`DROP TRIGGER fail_clear ON cart_items`)
		expect(t, c.request("POST", "/api/orders", orderBody(view.Total), key), 201)
	})
	t.Run("checkout_validation_and_cors", func(t *testing.T) {
		reset()
		c := client()
		expect(t, c.request("POST", "/api/orders", orderBody(0), model.UUID()), 401)
		register(t, &c, "validation@example.com")
		add(t, c, "point", 1)
		expect(t, c.request("POST", "/api/orders", orderBody(249000), ""), 400)
		r := c.request("POST", "/api/orders", map[string]any{"expectedTotal": 249000, "delivery": model.Delivery{}}, model.UUID())
		expect(t, r, 422)
		if len(decode[model.Error](t, r).Fields) < 5 {
			t.Fatal("delivery was not validated")
		}
		for _, origin := range []string{"http://127.0.0.1:5173", "https://untrusted.invalid"} {
			req, _ := http.NewRequest("OPTIONS", server.URL+"/api/orders", nil)
			req.Header.Set("Origin", origin)
			req.Header.Set("Access-Control-Request-Method", "POST")
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if origin == "http://127.0.0.1:5173" {
				if resp.StatusCode != 204 || resp.Header.Get("Access-Control-Allow-Credentials") != "true" || resp.Header.Get("Access-Control-Allow-Origin") != origin {
					t.Fatal("CORS preflight broken")
				}
			} else if resp.StatusCode != 403 {
				t.Fatal("foreign origin allowed")
			}
		}
		expect(t, c.request("GET", "/health/ready", nil, ""), 200)
	})
}
