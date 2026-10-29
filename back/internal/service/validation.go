package service

import (
	"forma/back/internal/model"
	"regexp"
	"strings"
	"unicode/utf8"
)

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
var phonePattern = regexp.MustCompile(`^[+0-9\s()-]+$`)

func normalizedEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
func validEmail(s string) bool        { return len(s) <= 254 && emailPattern.MatchString(s) }
func length(s string, min, max int) bool {
	n := utf8.RuneCountInString(strings.TrimSpace(s))
	return n >= min && n <= max
}
func validateCredentials(c *model.Credentials, register bool) error {
	c.Email = normalizedEmail(c.Email)
	c.Name = strings.TrimSpace(c.Name)
	fields := map[string]string{}
	if !validEmail(c.Email) {
		fields["email"] = "Введите корректный email."
	}
	if register && !length(c.Name, 2, 80) {
		fields["name"] = "Имя должно содержать от 2 до 80 символов."
	}
	n := utf8.RuneCountInString(c.Password)
	if n > 128 || n < 1 || (register && n < 8) {
		fields["password"] = "Пароль должен содержать от 8 до 128 символов."
	}
	if len(fields) > 0 {
		return model.Invalid(fields)
	}
	return nil
}
func validateDelivery(d *model.Delivery) error {
	d.Name = strings.TrimSpace(d.Name)
	d.Email = normalizedEmail(d.Email)
	d.City = strings.TrimSpace(d.City)
	d.Address = strings.TrimSpace(d.Address)
	d.Phone = strings.TrimSpace(d.Phone)
	d.Comment = strings.TrimSpace(d.Comment)
	fields := map[string]string{}
	if !length(d.Name, 2, 80) {
		fields["name"] = "Имя должно содержать от 2 до 80 символов."
	}
	if !validEmail(d.Email) {
		fields["email"] = "Введите корректный email."
	}
	digits := 0
	for _, c := range d.Phone {
		if c >= '0' && c <= '9' {
			digits++
		}
	}
	if !phonePattern.MatchString(d.Phone) || digits < 10 || digits > 15 || len(d.Phone) > 40 {
		fields["phone"] = "Введите телефон из 10–15 цифр."
	}
	if !length(d.City, 1, 100) {
		fields["city"] = "Укажите город, до 100 символов."
	}
	if !length(d.Address, 1, 250) {
		fields["address"] = "Укажите адрес, до 250 символов."
	}
	if !length(d.Comment, 0, 500) {
		fields["comment"] = "Комментарий — до 500 символов."
	}
	if len(fields) > 0 {
		return model.Invalid(fields)
	}
	return nil
}
