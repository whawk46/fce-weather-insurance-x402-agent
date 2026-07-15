package server

import (
	"weather-insurance/internal/typesserver"
	"weather-insurance/pkg/decoder"
	"weather-insurance/pkg/types"
)

// StartTypesServer creates the decoder registry, registers all decoders,
// and starts the types-server HTTP server in a goroutine.
// Returns an error channel that receives any ListenAndServe failure.
func StartTypesServer(port int) <-chan error {
	registry := decoder.NewRegistry()
	types.RegisterDecoders(registry)

	s := typesserver.New(registry)
	errCh := make(chan error, 1)
	go func() {
		if err := s.ListenAndServe(port); err != nil {
			errCh <- err
		}
	}()
	return errCh
}
