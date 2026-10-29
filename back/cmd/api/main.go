package main

import (
	"context"
	"errors"
	"fmt"
	"forma/back/internal/httpapi"
	"forma/back/internal/postgres"
	"forma/back/internal/service"
	"forma/back/migrations"
	"forma/back/seed"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func run() error {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	if command != "serve" && command != "migrate" && command != "seed" && command != "reset" {
		return fmt.Errorf("usage: api [serve|migrate|seed|reset --confirm-reset]")
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("set DATABASE_URL before starting")
	}
	origin := env("FRONTEND_ORIGIN", "http://127.0.0.1:5173")
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("FRONTEND_ORIGIN must be an exact http(s) origin without a trailing slash")
	}
	ttl, err := time.ParseDuration(env("SESSION_TTL", "24h"))
	if err != nil || ttl <= 0 {
		return errors.New("SESSION_TTL must be a positive duration")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return errors.New("invalid DATABASE_URL")
	}
	cfg.MaxConns = 12
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return errors.New("cannot initialize database connection")
	}
	defer db.Close()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err = db.Ping(startup); err != nil {
		return errors.New("database is unavailable; start PostgreSQL and check DATABASE_URL")
	}
	if err = migrations.Apply(startup, db); err != nil {
		return fmt.Errorf("migration failed: %w", err)
	}
	switch command {
	case "migrate":
		log.Info("migrations applied")
		return nil
	case "reset":
		if len(os.Args) != 3 || os.Args[2] != "--confirm-reset" {
			return errors.New("reset deletes shop data: use reset --confirm-reset explicitly")
		}
		tx, err := db.Begin(startup)
		if err != nil {
			return err
		}
		defer tx.Rollback(startup)
		if _, err = tx.Exec(startup, `TRUNCATE order_items,orders,cart_items,carts,sessions,users,products RESTART IDENTITY; ALTER SEQUENCE order_numbers RESTART WITH 1001`); err != nil {
			return err
		}
		if err = tx.Commit(startup); err != nil {
			return err
		}
		fallthrough
	case "seed":
		if err = seed.Apply(startup, db); err != nil {
			return err
		}
		log.Info("demo fixtures ready")
		return nil
	}
	shop := &service.Shop{Store: &postgres.Store{DB: db}, SessionTTL: ttl}
	server := &http.Server{Addr: env("HTTP_ADDR", "127.0.0.1:8080"), Handler: httpapi.New(shop, origin, log), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	finished := make(chan error, 1)
	go func() { finished <- server.ListenAndServe() }()
	log.Info("api listening", "address", server.Addr)
	select {
	case err = <-finished:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
	}
	shutdown, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	return server.Shutdown(shutdown)
}
func main() {
	if err := run(); err != nil {
		slog.Error("startup failed", "error", err)
		os.Exit(1)
	}
}
