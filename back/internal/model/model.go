package model

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"regexp"
	"time"
)

const MaxMoney int64 = 9007199254740991

type Spec struct {
	Label string `json:"label"`
	Value string `json:"value"`
}
type Product struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Detail      string `json:"detail"`
	Price       int64  `json:"price"`
	Stock       int64  `json:"stock"`
	Art         string `json:"art"`
	Tone        string `json:"tone"`
	Badge       string `json:"badge,omitempty"`
	Specs       []Spec `json:"specs"`
}
type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}
type CartItem struct {
	Product  Product `json:"product"`
	Quantity int64   `json:"quantity"`
}
type Cart struct {
	Items []CartItem `json:"items"`
	Count int64      `json:"count"`
	Total int64      `json:"total"`
}

func EmptyCart() Cart { return Cart{Items: []CartItem{}} }
func (c *Cart) Add(item CartItem) error {
	if item.Quantity < 0 || item.Product.Price < 0 || (item.Product.Price > 0 && item.Quantity > (MaxMoney-c.Total)/item.Product.Price) {
		return Fail(409, "CART_LIMIT", "Сумма корзины слишком велика.")
	}
	c.Items = append(c.Items, item)
	c.Count += item.Quantity
	c.Total += item.Quantity * item.Product.Price
	return nil
}

type AuthResult struct {
	User     User     `json:"user"`
	Token    string   `json:"token"`
	Cart     Cart     `json:"cart"`
	Warnings []string `json:"warnings"`
}
type Credentials struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}
type Delivery struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Phone   string `json:"phone"`
	City    string `json:"city"`
	Address string `json:"address"`
	Comment string `json:"comment"`
}
type Order struct {
	ID        string     `json:"id"`
	Number    string     `json:"number"`
	UserID    string     `json:"userId"`
	CreatedAt time.Time  `json:"createdAt"`
	Items     []CartItem `json:"items"`
	Total     int64      `json:"total"`
	Delivery  Delivery   `json:"delivery"`
}
type Error struct {
	Status  int               `json:"-"`
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func (e *Error) Error() string { return e.Message }
func Fail(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}
func Invalid(fields map[string]string) *Error {
	return &Error{Status: 422, Code: "VALIDATION_ERROR", Message: "Проверьте заполненные поля.", Fields: fields}
}
func Unauthorized() *Error {
	return Fail(401, "UNAUTHORIZED", "Сессия завершилась. Войдите ещё раз — корзина сохранена.")
}
func NotFound() *Error {
	return Fail(404, "NOT_FOUND", "Запрошенный объект не найден.")
}
func UUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

var uuid4 = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func ValidUUID(s string) bool { return uuid4.MatchString(s) }
func Token() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
func Hash(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
