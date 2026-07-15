// Package main provides a standalone entry point for the types-server.
package main

import (
	"log"

	"weather-insurance/internal/config"
	"weather-insurance/internal/typesserver"
	"weather-insurance/pkg/decoder"
	"weather-insurance/pkg/types"
)

func main() {
	registry := decoder.NewRegistry()
	types.RegisterDecoders(registry)

	s := typesserver.New(registry)
	log.Fatal(s.ListenAndServe(config.TypesServerPort))
}
