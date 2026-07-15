package extension

import (
	"os"
	"testing"

	"weather-insurance/internal/config"
)

// TestFetchWeather_Berlin exercises the real OpenWeatherMap API. Skipped unless
// OPENWEATHERMAP_API_KEY is set, since it makes a live network call.
//
//	OPENWEATHERMAP_API_KEY=<key> go test ./internal/extension -run Berlin -v
func TestFetchWeather_Berlin(t *testing.T) {
	apiKey := os.Getenv("OPENWEATHERMAP_API_KEY")
	if apiKey == "" {
		t.Skip("OPENWEATHERMAP_API_KEY not set; skipping live API test")
	}
	config.OpenWeatherMapAPIKey = apiKey

	report, err := fetchWeather("Berlin,DE")
	if err != nil {
		t.Fatalf("fetchWeather: %v", err)
	}

	if report.City != "Berlin" {
		t.Errorf("expected city Berlin, got %q", report.City)
	}
	if report.Country != "DE" {
		t.Errorf("expected country DE, got %q", report.Country)
	}
	if report.ObservedAt == 0 {
		t.Errorf("expected non-zero observedAt timestamp")
	}
	t.Logf("Berlin report: %+v", *report)
}
