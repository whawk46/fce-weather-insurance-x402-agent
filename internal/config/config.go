// Package config contains configuration values and defaults used by the extension.
package config

import (
	"os"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

const (
	Version = "0.2.1"

	// OPType and OPCommand strings — must match the bytes32 constants in contracts/InstructionSender.sol.
	OPTypeWeather   = "WEATHER"
	OPCommandFetch  = "FETCH"
	OPCommandSettle = "SETTLE"
	OPCommandBuy    = "BUY"

	TimeoutShutdown = 5 * time.Second

	// OpenWeatherMapBaseURL is the current-weather endpoint (FETCH). The handler
	// appends query params (q=<city>, units=metric, appid=<key>).
	OpenWeatherMapBaseURL = "https://api.openweathermap.org/data/2.5/weather"

	// OneCallDaySummaryBaseURL is the One Call 3.0 daily-aggregation endpoint
	// (SETTLE). The handler appends (lat, lon, date, units=metric, appid=<key>)
	// and reads precipitation.total. Requires a One Call subscription on the key.
	OneCallDaySummaryBaseURL = "https://api.openweathermap.org/data/3.0/onecall/day_summary"

	// HTTPTimeout bounds outbound calls to OpenWeatherMap. Settlement uses One Call
	// day_summary, which can be slow; the extension completes those asynchronously.
	HTTPTimeout = 30 * time.Second
)

// Defaults — overridden by env vars in init().
var (
	ExtensionPort   = 7702
	SignPort        = 7701
	ConfigPort      = 5501
	TypesServerPort = 8100

	// OpenWeatherMapAPIKey is loaded from the OPENWEATHERMAP_API_KEY env var
	// at process start. The TEE refuses to handle FETCH actions if it is empty.
	OpenWeatherMapAPIKey = ""

	// ChainURL and InstructionSender let the TEE re-verify (redundantly —
	// see internal/extension/payment.go) that a FeeCollected event exists for
	// the request it's processing. Not required for the contract's own
	// enforcement, which is unconditional regardless of these being set.
	ChainURL          = "http://127.0.0.1:8545"
	InstructionSender common.Address
)

func init() {
	if v := os.Getenv("EXTENSION_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			ExtensionPort = n
		}
	}
	if v := os.Getenv("SIGN_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			SignPort = n
		}
	}
	if v := os.Getenv("CONFIG_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			ConfigPort = n
		}
	}
	if v := os.Getenv("TYPES_SERVER_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			TypesServerPort = n
		}
	}
	OpenWeatherMapAPIKey = os.Getenv("OPENWEATHERMAP_API_KEY")
	if v := os.Getenv("CHAIN_URL"); v != "" {
		ChainURL = v
	}
	if v := os.Getenv("INSTRUCTION_SENDER"); v != "" {
		InstructionSender = common.HexToAddress(v)
	}
}
