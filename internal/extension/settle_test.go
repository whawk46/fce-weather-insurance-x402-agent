package extension

import (
	"os"
	"testing"

	"weather-insurance/internal/config"
)

// TestFetchDaySummary_Berlin exercises the real One Call day_summary endpoint.
// Skipped unless OPENWEATHERMAP_API_KEY is set (and has a One Call subscription).
//
//	OPENWEATHERMAP_API_KEY=<key> go test ./internal/extension -run DaySummary -v
func TestFetchDaySummary_Berlin(t *testing.T) {
	apiKey := os.Getenv("OPENWEATHERMAP_API_KEY")
	if apiKey == "" {
		t.Skip("OPENWEATHERMAP_API_KEY not set; skipping live One Call test")
	}
	config.OpenWeatherMapAPIKey = apiKey

	mmE2, err := fetchDaySummaryPrecipitationMmE2("52.52", "13.405", "2026-05-26")
	if err != nil {
		t.Fatalf("fetchDaySummaryPrecipitationMmE2: %v", err)
	}
	if mmE2 == nil || mmE2.Sign() < 0 {
		t.Fatalf("expected non-negative precipitation, got %v", mmE2)
	}
	t.Logf("Berlin 2026-05-26 precipitation: %s mm×100 (= %.2f mm)", mmE2.String(), float64(mmE2.Int64())/100)
}
