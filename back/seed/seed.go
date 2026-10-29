package seed

import (
	"context"
	_ "embed"
	"encoding/json"
	"forma/back/internal/model"
	"forma/back/internal/service"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed products.json
var productsJSON []byte

// Apply inserts missing demo fixtures; rerunning does not reset stock or passwords.
func Apply(ctx context.Context, db *pgxpool.Pool) error {
	var products []model.Product
	if err := json.Unmarshal(productsJSON, &products); err != nil {
		return err
	}
	hash := service.PasswordHash("Demo12345")
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for _, p := range products {
		specs, err := json.Marshal(p.Specs)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO products(id,name,category,description,detail,price,stock,art,tone,badge,specs) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`, p.ID, p.Name, p.Category, p.Description, p.Detail, p.Price, p.Stock, p.Art, p.Tone, p.Badge, specs); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO users(id,name,email,password_hash) VALUES($1,'Покупатель','demo@example.com',$2) ON CONFLICT DO NOTHING`, model.UUID(), hash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
