package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"forma/back/internal/model"
	"forma/back/internal/postgres"
	"forma/back/internal/service"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

type API struct {
	Shop   *service.Shop
	Origin string
	Log    *slog.Logger
}
type endpoint func(http.ResponseWriter, *http.Request, service.Identity) (any, int, error)

func New(shop *service.Shop, origin string, log *slog.Logger) http.Handler {
	a := &API{shop, origin, log}
	m := http.NewServeMux()
	m.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]string{"status": "ok"}) })
	m.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if shop.Store.DB.Ping(ctx) != nil {
			respond(w, 503, model.Fail(503, "NOT_READY", "База данных недоступна."))
			return
		}
		respond(w, 200, map[string]string{"status": "ok"})
	})
	m.HandleFunc("GET /api/products", a.wrap(false, func(w http.ResponseWriter, r *http.Request, i service.Identity) (any, int, error) {
		q := r.URL.Query()
		p, e := postgres.Products(r.Context(), shop.Store.DB, q.Get("q"), q.Get("category"), q.Get("sort"))
		return p, 200, e
	}))
	m.HandleFunc("GET /api/products/{id}", a.wrap(false, func(w http.ResponseWriter, r *http.Request, i service.Identity) (any, int, error) {
		p, e := postgres.Product(r.Context(), shop.Store.DB, r.PathValue("id"), false)
		return p, 200, e
	}))
	for _, path := range []string{"login", "register"} {
		m.HandleFunc("POST /api/auth/"+path, a.wrap(false, func(w http.ResponseWriter, r *http.Request, i service.Identity) (any, int, error) {
			var c model.Credentials
			if e := decode(w, r, &c); e != nil {
				return nil, 0, e
			}
			v, e := shop.Authenticate(r.Context(), c, i.Guest, path == "register")
			status := 200
			if path == "register" {
				status = 201
			}
			return v, status, e
		}))
	}
	m.HandleFunc("GET /api/auth/me", a.wrap(true, func(w http.ResponseWriter, r *http.Request, i service.Identity) (any, int, error) {
		return i.User, 200, nil
	}))
	m.HandleFunc("POST /api/auth/logout", a.wrap(true, func(w http.ResponseWriter, r *http.Request, i service.Identity) (any, int, error) {
		e := postgres.DeleteSession(r.Context(), shop.Store.DB, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		return nil, 204, e
	}))
	m.HandleFunc("GET /api/cart", a.wrap(false, func(w http.ResponseWriter, r *http.Request, i service.Identity) (any, int, error) {
		c, e := shop.Cart(r.Context(), i)
		return c, 200, e
	}))
	for _, method := range []string{"POST", "PATCH", "DELETE"} {
		path := "/api/cart/items/{id}"
		if method == "POST" {
			path = "/api/cart/items"
		}
		m.HandleFunc(method+" "+path, a.wrap(false, func(w http.ResponseWriter, r *http.Request, i service.Identity) (any, int, error) {
			var b struct {
				ProductID string `json:"productId"`
				Quantity  *int64 `json:"quantity"`
			}
			if method != "DELETE" {
				if e := decode(w, r, &b); e != nil {
					return nil, 0, e
				}
				if b.Quantity == nil {
					return nil, 0, model.Invalid(map[string]string{"quantity": "Укажите количество."})
				}
			}
			id := r.PathValue("id")
			if method == "POST" {
				id = b.ProductID
			}
			var qty int64
			if b.Quantity != nil {
				qty = *b.Quantity
			}
			c, e := shop.ChangeCart(r.Context(), i, id, qty, method == "POST")
			return c, 200, e
		}))
	}
	m.HandleFunc("POST /api/orders", a.wrap(true, func(w http.ResponseWriter, r *http.Request, i service.Identity) (any, int, error) {
		var b struct {
			Delivery      model.Delivery `json:"delivery"`
			ExpectedTotal *int64         `json:"expectedTotal"`
		}
		if e := decode(w, r, &b); e != nil {
			return nil, 0, e
		}
		if b.ExpectedTotal == nil {
			return nil, 0, model.Invalid(map[string]string{"expectedTotal": "Укажите сумму в копейках."})
		}
		o, e := shop.CreateOrder(r.Context(), i.User.ID, b.Delivery, *b.ExpectedTotal, r.Header.Get("Idempotency-Key"))
		return o, 201, e
	}))
	m.HandleFunc("GET /api/orders/{id}", a.wrap(true, func(w http.ResponseWriter, r *http.Request, i service.Identity) (any, int, error) {
		id := r.PathValue("id")
		if !model.ValidUUID(id) {
			return nil, 0, model.NotFound()
		}
		o, e := postgres.Order(r.Context(), shop.Store.DB, i.User.ID, id)
		return o, 200, e
	}))
	return a.middleware(m)
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			return model.Fail(413, "BODY_TOO_LARGE", "Слишком большой запрос.")
		}
		var typ *json.UnmarshalTypeError
		if errors.As(err, &typ) {
			return model.Invalid(map[string]string{typ.Field: "Неверный тип значения."})
		}
		return model.Fail(400, "INVALID_JSON", "Некорректный JSON запроса.")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return model.Fail(400, "INVALID_JSON", "Ожидается один JSON-объект.")
	}
	return nil
}
func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if status != 204 {
		json.NewEncoder(w).Encode(data)
	}
}
func (a *API) wrap(required bool, fn endpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := ""
		if h := r.Header.Get("Authorization"); h != "" {
			if !strings.HasPrefix(h, "Bearer ") || len(h) <= 7 || len(h) > 256 {
				respond(w, 401, model.Unauthorized())
				return
			}
			token = h[7:]
		}
		i, err := a.Shop.Identity(r.Context(), token, r.Header.Get("X-Guest-Id"))
		if err == nil && required && i.User.ID == "" {
			err = model.Unauthorized()
		}
		var data any
		status := 200
		if err == nil {
			data, status, err = fn(w, r, i)
		}
		if err != nil {
			var e *model.Error
			if !errors.As(err, &e) {
				a.Log.Error("request failed", "requestId", w.Header().Get("X-Request-Id"), "errorType", fmtErrorType(err))
				e = model.Fail(500, "INTERNAL_ERROR", "Не удалось выполнить запрос. Попробуйте ещё раз.")
			}
			respond(w, e.Status, e)
			return
		}
		respond(w, status, data)
	}
}

// Only classify internal failures; SQL errors can contain user-supplied values.
func fmtErrorType(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	return "internal"
}

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (w *responseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (a *API) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{w, 200}
		id := model.UUID()
		rw.Header().Set("X-Request-Id", id)
		rw.Header().Set("Cache-Control", "no-store")
		rw.Header().Set("X-Content-Type-Options", "nosniff")
		defer func() {
			if recover() != nil {
				respond(rw, 500, model.Fail(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера."))
			}
			a.Log.Info("http", "requestId", id, "method", r.Method, "route", r.Pattern, "status", rw.status, "duration", time.Since(start))
		}()
		if origin := r.Header.Get("Origin"); origin != "" {
			rw.Header().Add("Vary", "Origin")
			if origin != a.Origin {
				respond(rw, 403, model.Fail(403, "ORIGIN_DENIED", "Источник запроса не разрешён."))
				return
			}
			rw.Header().Set("Access-Control-Allow-Origin", a.Origin)
			rw.Header().Set("Access-Control-Allow-Credentials", "true")
			rw.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Guest-Id, Idempotency-Key")
			rw.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		}
		if r.Method == "OPTIONS" {
			rw.WriteHeader(204)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		next.ServeHTTP(rw, r)
	})
}
