package extension

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"time"

	"weather-insurance/internal/config"
	"weather-insurance/pkg/types"

	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	"github.com/flare-foundation/tee-node/pkg/processorutils"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

// --- In most cases, you will not need to modify this file. ---

func (e *Extension) actionHandler(w http.ResponseWriter, r *http.Request) {
	var action teetypes.Action
	err := json.NewDecoder(r.Body).Decode(&action)
	if err != nil {
		http.Error(w, fmt.Sprintf("decoding action: %v", err), http.StatusBadRequest)
		return
	}

	logger.Infof("received action, ID: %s", action.Data.ID)

	if df, async := weatherDataFixed(action); async {
		go e.finishActionAsync(action)
		body, _ := json.Marshal(inProgressResult(action, df))
		logger.Infof("deferring action %s (OpenWeatherMap)", action.Data.ID)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
		return
	}

	status, body := e.processAction(action)

	logger.Infof("sending action result, ID: %s, status: %d, log: %s", action.Data.ID, status, getLogFromBody(body))

	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// weatherDataFixed returns parsed instruction data when the action is a WEATHER
// FETCH or SETTLE that may call OpenWeatherMap (too slow for tee-node's 2s POST timeout).
func weatherDataFixed(action teetypes.Action) (*instruction.DataFixed, bool) {
	df, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
	if err != nil {
		return nil, false
	}
	if df.OPType != teeutils.ToHash(config.OPTypeWeather) {
		return nil, false
	}
	switch df.OPCommand {
	case teeutils.ToHash(config.OPCommandFetch), teeutils.ToHash(config.OPCommandSettle):
		return df, true
	default:
		return df, false
	}
}

func inProgressResult(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	return teetypes.ActionResult{
		ID:            action.Data.ID,
		SubmissionTag: action.Data.SubmissionTag,
		Status:        2,
		Log:           "action in processing",
		OPType:        df.OPType,
		OPCommand:     df.OPCommand,
		Version:       config.Version,
	}
}

func (e *Extension) finishActionAsync(action teetypes.Action) {
	status, body := e.processAction(action)
	if status != http.StatusOK {
		logger.Errorf("async action %s failed: %s", action.Data.ID, string(body))
		return
	}
	var ar teetypes.ActionResult
	if err := json.Unmarshal(body, &ar); err != nil {
		logger.Errorf("async action %s: decode result: %v", action.Data.ID, err)
		return
	}
	if err := postActionResultToNode(e.signPort, ar); err != nil {
		logger.Errorf("async action %s: post result: %v", action.Data.ID, err)
		return
	}
	logger.Infof("async action %s posted to tee-node, status=%d", action.Data.ID, ar.Status)
}

func buildResult(a teetypes.Action, df *instruction.DataFixed, data []byte, status uint8, err error) teetypes.ActionResult {
	ar := teetypes.ActionResult{
		ID:            a.Data.ID,
		SubmissionTag: a.Data.SubmissionTag,
		Version:       config.Version,
		OPType:        df.OPType,
		OPCommand:     df.OPCommand,
		Data:          data,
		Status:        status,
	}
	switch status {
	case 0:
		ar.Log = fmt.Sprintf("error: %v", err)
	case 1:
		ar.Log = "ok"
	}
	return ar
}

func getLogFromBody(body []byte) string {
	var ar teetypes.ActionResult
	if err := json.Unmarshal(body, &ar); err != nil {
		return string(body)
	}
	return ar.Log
}

// --- TEE node /decrypt RPC ---

type decryptRequest struct {
	EncryptedMessage []byte `json:"encryptedMessage"`
}

type decryptResponse struct {
	DecryptedMessage []byte `json:"decryptedMessage"`
}

// postActionResultToNode delivers a completed ActionResult to the tee-node sign server,
// which signs it and forwards it to the extension proxy (async extension pattern).
func postActionResultToNode(signPort int, result teetypes.ActionResult) error {
	url := fmt.Sprintf("http://localhost:%d/result", signPort)
	body, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	resp, err := http.DefaultClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("post: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("node returned %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

// decryptViaNode forwards ECIES ciphertext to the local tee-node /decrypt endpoint.
func decryptViaNode(signPort int, ciphertext []byte) ([]byte, error) {
	url := fmt.Sprintf("http://localhost:%d/decrypt", signPort)
	reqBody, _ := json.Marshal(decryptRequest{EncryptedMessage: ciphertext})

	resp, err := http.DefaultClient.Post(url, "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("request error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("node returned %d: %s", resp.StatusCode, string(b))
	}

	var dr decryptResponse
	if err := json.NewDecoder(resp.Body).Decode(&dr); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return dr.DecryptedMessage, nil
}

// --- OpenWeatherMap client ---

// openWeatherMapResponse mirrors the subset of fields we care about from
// https://api.openweathermap.org/data/2.5/weather (units=metric).
type openWeatherMapResponse struct {
	Name string `json:"name"`
	Sys  struct {
		Country string `json:"country"`
	} `json:"sys"`
	Weather []struct {
		Description string `json:"description"`
	} `json:"weather"`
	Main struct {
		Temp      float64 `json:"temp"`
		FeelsLike float64 `json:"feels_like"`
		Humidity  int     `json:"humidity"`
		Pressure  int     `json:"pressure"`
	} `json:"main"`
	Wind struct {
		Speed float64 `json:"speed"`
	} `json:"wind"`
	Dt int64 `json:"dt"`
}

// fetchWeather hits OpenWeatherMap with the given city query and returns a
// trimmed report. units=metric is requested so temperatures are in Celsius.
func fetchWeather(city string) (*types.WeatherReport, error) {
	q := url.Values{}
	q.Set("q", city)
	q.Set("units", "metric")
	q.Set("appid", config.OpenWeatherMapAPIKey)

	endpoint := config.OpenWeatherMapBaseURL + "?" + q.Encode()

	client := &http.Client{Timeout: config.HTTPTimeout}
	resp, err := client.Get(endpoint)
	if err != nil {
		return nil, fmt.Errorf("request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openweathermap %d: %s", resp.StatusCode, string(body))
	}

	var raw openWeatherMapResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	report := &types.WeatherReport{
		City:        raw.Name,
		Country:     raw.Sys.Country,
		TempC:       raw.Main.Temp,
		FeelsLikeC:  raw.Main.FeelsLike,
		HumidityPct: raw.Main.Humidity,
		PressureHpa: raw.Main.Pressure,
		WindMS:      raw.Wind.Speed,
		ObservedAt:  raw.Dt,
	}
	if len(raw.Weather) > 0 {
		report.Description = raw.Weather[0].Description
	}
	if report.ObservedAt == 0 {
		report.ObservedAt = time.Now().Unix()
	}
	return report, nil
}

// daySummaryResponse mirrors the subset we read from One Call day_summary.
type daySummaryResponse struct {
	Precipitation struct {
		Total float64 `json:"total"`
	} `json:"precipitation"`
}

// fetchDaySummaryPrecipitationMmE2 calls the One Call day_summary endpoint for the
// given location/date and returns precipitation.total as millimetres × 100
// (rounded), so the value is an integer suitable for on-chain threshold comparison.
func fetchDaySummaryPrecipitationMmE2(lat, lon, date string) (*big.Int, error) {
	q := url.Values{}
	q.Set("lat", lat)
	q.Set("lon", lon)
	q.Set("date", date)
	q.Set("units", "metric")
	q.Set("appid", config.OpenWeatherMapAPIKey)

	endpoint := config.OneCallDaySummaryBaseURL + "?" + q.Encode()

	client := &http.Client{Timeout: config.HTTPTimeout}
	resp, err := client.Get(endpoint)
	if err != nil {
		return nil, fmt.Errorf("request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("onecall day_summary %d: %s", resp.StatusCode, string(body))
	}

	var raw daySummaryResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	// mm → mm×100, rounded to the nearest integer.
	mmE2 := int64(math.Round(raw.Precipitation.Total * 100))
	if mmE2 < 0 {
		mmE2 = 0
	}
	return big.NewInt(mmE2), nil
}
