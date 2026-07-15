// Package main runs the x402 payment gateway: an HTTP facilitator that fronts
// the two OpenWeatherMap-backed TEE instructions (ad-hoc weather FETCH and
// policy SETTLE) with a visible 402 Payment Required -> approve -> retry
// handshake. The gateway's wallet must be the contract's registered `gateway`
// address (see setGateway) — getWeather/requestSettlement are onlyGateway, and
// pull any configured feeToken fee from the named payer atomically via
// transferFrom. That on-chain pull is the actual enforcement; this HTTP layer
// is a convenience front door, not the trust boundary.
//
//	go run ./tools/cmd/x402-gateway -contract 0x...
package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"weather-insurance/tools/pkg/configs"
	"weather-insurance/tools/pkg/contracts/weather"
	"weather-insurance/tools/pkg/support"
	"weather-insurance/tools/pkg/x402"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// addressesFileDefault resolves ADDRESSES_FILE from .env (repo-root-relative) or
// falls back to the local-devnet default (relative to tools/ cwd).
func addressesFileDefault() string {
	v := os.Getenv("ADDRESSES_FILE")
	if v == "" {
		return configs.AddressesFile
	}
	if filepath.IsAbs(v) {
		return v
	}
	v = strings.TrimPrefix(v, "./")
	return filepath.Join(support.ProjectRoot(), v)
}

func main() {
	support.LoadProjectEnv()

	af := flag.String("a", addressesFileDefault(), "file with deployed addresses")
	cf := flag.String("c", envOr("CHAIN_URL", configs.ChainNodeURL), "chain node url")
	pf := flag.String("p", envOr("EXT_PROXY_URL", configs.ExtensionProxyURL), "extension proxy url")
	contractF := flag.String("contract", os.Getenv("INSTRUCTION_SENDER"), "WeatherInsurance contract address")
	flag.Parse()

	if *contractF == "" {
		logger.Fatal("--contract is required (or set INSTRUCTION_SENDER in .env)")
	}
	contractAddr := common.HexToAddress(*contractF)

	s, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		logger.Fatalf("support: %s", err)
	}

	contract, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		logger.Fatalf("bind contract: %s", err)
	}

	gatewayAddr := crypto.PubkeyToAddress(s.Prv.PublicKey)
	logger.Infof("this wallet: %s (must match WeatherInsurance.gateway() on-chain)", gatewayAddr.Hex())

	port := envOr("X402_GATEWAY_PORT", "7703")

	h := &x402.Handler{
		Support:      s,
		Contract:     contract,
		ContractAddr: contractAddr,
		ProxyURL:     *pf,
		ChainID:      s.ChainID,
		CORSOrigin:   os.Getenv("CORS_ORIGIN"),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /x402/weather/fetch", h.FetchHandler)
	mux.HandleFunc("OPTIONS /x402/weather/fetch", h.FetchHandler)
	mux.HandleFunc("POST /x402/weather/settle", h.SettleHandler)
	mux.HandleFunc("OPTIONS /x402/weather/settle", h.SettleHandler)

	addr := fmt.Sprintf(":%s", port)
	logger.Infof("x402 gateway listening on %s (contract=%s)", addr, contractAddr.Hex())
	if err := http.ListenAndServe(addr, mux); err != nil {
		logger.Fatalf("gateway server: %s", err)
	}
}
