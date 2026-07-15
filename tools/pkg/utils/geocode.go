package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
)

const openWeatherWeatherURL = "https://api.openweathermap.org/data/2.5/weather"

type geocodeResponse struct {
	Coord struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	} `json:"coord"`
}

func formatCoord(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

// GeocodeCity resolves a City,CC query to decimal lat/lon strings via OpenWeatherMap.
func GeocodeCity(city string) (lat, lon string, err error) {
	apiKey := os.Getenv("OPENWEATHERMAP_API_KEY")
	if apiKey == "" {
		return "", "", fmt.Errorf("OPENWEATHERMAP_API_KEY is not set")
	}
	if city == "" {
		return "", "", fmt.Errorf("city query is empty")
	}

	q := url.Values{}
	q.Set("q", city)
	q.Set("units", "metric")
	q.Set("appid", apiKey)

	resp, err := http.Get(openWeatherWeatherURL + "?" + q.Encode())
	if err != nil {
		return "", "", fmt.Errorf("request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("openweathermap %d: %s", resp.StatusCode, string(body))
	}

	var raw geocodeResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", "", fmt.Errorf("decode: %w", err)
	}
	if raw.Coord.Lat == 0 && raw.Coord.Lon == 0 {
		return "", "", fmt.Errorf("coordinates missing from response")
	}

	return formatCoord(raw.Coord.Lat), formatCoord(raw.Coord.Lon), nil
}
