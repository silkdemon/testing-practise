package service

import (
	"context"
	"errors"
	"fmt"
	"forma/back/internal/model"
	"forma/back/internal/postgres"
	"github.com/jackc/pgx/v5"
	"time"
)

type Shop struct {
	Store      *postgres.Store
	SessionTTL time.Duration
}
type Identity struct {
	User  model.User
	Guest string
}

func (s *Shop) Identity(ctx context.Context, token, guest string) (Identity, error) {
	i := Identity{Guest: guest}
	if token != "" {
		u, err := postgres.SessionUser(ctx, s.Store.DB, token)
		i.User = u
		return i, err
	}
	return i, nil
}
func guestHash(guest string) (string, error) {
	if !model.ValidUUID(guest) {
		return "", model.Fail(400, "GUEST_REQUIRED", "Нужен корректный X-Guest-Id (UUID v4).")
	}
	return model.Hash(guest), nil
}
func (s *Shop) Authenticate(ctx context.Context, c model.Credentials, guest string, register bool) (model.AuthResult, error) {
	result := model.AuthResult{Warnings: []string{}}
	hash, err := guestHash(guest)
	if err != nil {
		return result, err
	}
	if err = validateCredentials(&c, register); err != nil {
		return result, err
	}
	var user model.User
	var password string
	if register {
		user = model.User{ID: model.UUID(), Name: c.Name, Email: c.Email}
		password = PasswordHash(c.Password)
	} else {
		user, password, err = postgres.FindUser(ctx, s.Store.DB, c.Email)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return result, err
		}
		if errors.Is(err, pgx.ErrNoRows) {
			PasswordHash(c.Password)
			return result, model.Fail(400, "INVALID_CREDENTIALS", "Неверный email или пароль.")
		}
		if !PasswordMatches(c.Password, password) {
			return result, model.Fail(400, "INVALID_CREDENTIALS", "Неверный email или пароль.")
		}
	}
	tx, err := s.Store.DB.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	if register {
		if err = postgres.InsertUser(ctx, tx, user, password); err != nil {
			return result, err
		}
	}
	guestCart, err := postgres.EnsureCart(ctx, tx, "", hash)
	if err != nil {
		return result, err
	}
	accountCart, err := postgres.EnsureCart(ctx, tx, user.ID, "")
	if err != nil {
		return result, err
	}
	if err = postgres.LockCarts(ctx, tx, guestCart, accountCart); err != nil {
		return result, err
	}
	if err = postgres.LockProducts(ctx, tx, guestCart, accountCart); err != nil {
		return result, err
	}
	gc, err := postgres.Cart(ctx, tx, guestCart)
	if err != nil {
		return result, err
	}
	ac, err := postgres.Cart(ctx, tx, accountCart)
	if err != nil {
		return result, err
	}
	items := map[string]model.CartItem{}
	for _, i := range ac.Items {
		items[i.Product.ID] = i
	}
	for _, i := range gc.Items {
		previous := items[i.Product.ID]
		i.Quantity += previous.Quantity
		items[i.Product.ID] = i
	}
	for id, i := range items {
		if i.Quantity > i.Product.Stock {
			i.Quantity = i.Product.Stock
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: количество уменьшено до %d по доступному остатку.", i.Product.Name, i.Quantity))
		}
		if err = postgres.SetQuantity(ctx, tx, accountCart, id, i.Quantity); err != nil {
			return result, err
		}
	}
	if err = postgres.ClearCart(ctx, tx, guestCart); err != nil {
		return result, err
	}
	result.User = user
	result.Token = model.Token()
	result.Cart, err = postgres.Cart(ctx, tx, accountCart)
	if err != nil {
		return result, err
	}
	if err = postgres.InsertSession(ctx, tx, user.ID, result.Token, time.Now().Add(s.SessionTTL)); err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}
func cartID(ctx context.Context, q postgres.Queryer, i Identity) (string, error) {
	if i.User.ID != "" {
		return postgres.EnsureCart(ctx, q, i.User.ID, "")
	}
	hash, err := guestHash(i.Guest)
	if err != nil {
		return "", err
	}
	return postgres.EnsureCart(ctx, q, "", hash)
}
func (s *Shop) Cart(ctx context.Context, i Identity) (model.Cart, error) {
	id, err := cartID(ctx, s.Store.DB, i)
	if err != nil {
		return model.Cart{}, err
	}
	return postgres.Cart(ctx, s.Store.DB, id)
}
func (s *Shop) ChangeCart(ctx context.Context, i Identity, product string, quantity int64, add bool) (model.Cart, error) {
	c := model.EmptyCart()
	if quantity < 0 || quantity > 2147483647 || (add && quantity == 0) {
		return c, model.Invalid(map[string]string{"quantity": "Укажите целое допустимое количество."})
	}
	tx, err := s.Store.DB.Begin(ctx)
	if err != nil {
		return c, err
	}
	defer tx.Rollback(ctx)
	id, err := cartID(ctx, tx, i)
	if err != nil {
		return c, err
	}
	if err = postgres.LockCarts(ctx, tx, id); err != nil {
		return c, err
	}
	p, err := postgres.Product(ctx, tx, product, true)
	if err != nil {
		return c, err
	}
	if add {
		old, err := postgres.Cart(ctx, tx, id)
		if err != nil {
			return c, err
		}
		for _, item := range old.Items {
			if item.Product.ID == product {
				quantity += item.Quantity
			}
		}
	}
	if quantity > p.Stock {
		return c, model.Fail(409, "STOCK_LIMIT", fmt.Sprintf("Доступно только %d шт. товара «%s».", p.Stock, p.Name))
	}
	if err = postgres.SetQuantity(ctx, tx, id, product, quantity); err != nil {
		return c, err
	}
	c, err = postgres.Cart(ctx, tx, id)
	if err != nil {
		return c, err
	}
	return c, tx.Commit(ctx)
}
func (s *Shop) CreateOrder(ctx context.Context, user string, d model.Delivery, expected int64, key string) (model.Order, error) {
	var o model.Order
	if user == "" {
		return o, model.Unauthorized()
	}
	if !model.ValidUUID(key) {
		return o, model.Fail(400, "IDEMPOTENCY_REQUIRED", "Нужен Idempotency-Key в формате UUID v4.")
	}
	tx, err := s.Store.DB.Begin(ctx)
	if err != nil {
		return o, err
	}
	defer tx.Rollback(ctx)
	id, err := postgres.EnsureCart(ctx, tx, user, "")
	if err != nil {
		return o, err
	}
	if err = postgres.LockCarts(ctx, tx, id); err != nil {
		return o, err
	}
	o, err = postgres.OrderByKey(ctx, tx, user, key)
	if err == nil {
		return o, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return o, err
	}
	if err = validateDelivery(&d); err != nil {
		return o, err
	}
	if expected < 0 || expected > model.MaxMoney {
		return o, model.Invalid(map[string]string{"expectedTotal": "Укажите сумму в целых копейках."})
	}
	if err = postgres.LockProducts(ctx, tx, id); err != nil {
		return o, err
	}
	cart, err := postgres.Cart(ctx, tx, id)
	if err != nil {
		return o, err
	}
	if len(cart.Items) == 0 {
		return o, model.Fail(409, "EMPTY_CART", "Корзина пуста. Добавьте товары перед оформлением.")
	}
	changed := false
	for _, item := range cart.Items {
		if item.Quantity > item.Product.Stock {
			changed = true
			if err = postgres.SetQuantity(ctx, tx, id, item.Product.ID, item.Product.Stock); err != nil {
				return o, err
			}
		}
	}
	if changed {
		// A stock conflict intentionally commits only the normalized cart.
		if err = tx.Commit(ctx); err != nil {
			return o, err
		}
		return o, model.Fail(409, "STOCK_CHANGED", "Доступное количество изменилось. Корзина обновлена; проверьте состав заказа.")
	}
	if cart.Total != expected {
		return o, model.Fail(409, "PRICE_CHANGED", "Стоимость изменилась. Проверьте обновлённую сумму.")
	}
	o, err = postgres.InsertOrder(ctx, tx, user, key, cart, d)
	if err != nil {
		return o, err
	}
	if err = postgres.ClearCart(ctx, tx, id); err != nil {
		return o, err
	}
	return o, tx.Commit(ctx)
}
