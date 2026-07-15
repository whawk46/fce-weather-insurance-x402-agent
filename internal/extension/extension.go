package extension

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"weather-insurance/internal/config"
	"weather-insurance/pkg/settlementtime"
	"weather-insurance/pkg/types"

	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	"github.com/flare-foundation/go-flare-common/pkg/tee/structs"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"

	"github.com/flare-foundation/tee-node/pkg/processorutils"
)

// Extension is stateless — the weather-insurance extension relays FETCH
// instructions to OpenWeatherMap and returns the parsed payload.
type Extension struct {
	Server *http.Server

	// signPort is the TEE node's /decrypt endpoint (used for private policy buy).
	signPort int

	mu           sync.RWMutex
	privateTerms map[common.Hash]types.PrivateBuyParams
}

// --- DO NOT MODIFY: New(), actionHandler() are boilerplate.
func New(extensionPort, signPort int) *Extension {
	e := &Extension{
		signPort:     signPort,
		privateTerms: make(map[common.Hash]types.PrivateBuyParams),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /state", e.stateHandler)
	mux.HandleFunc("POST /action", e.actionHandler)

	e.Server = &http.Server{Addr: fmt.Sprintf(":%d", extensionPort), Handler: mux}
	return e
}

// stateHandler reports whether the OpenWeatherMap API key has been provisioned.
func (e *Extension) stateHandler(w http.ResponseWriter, r *http.Request) {
	stateResponse := types.StateResponse{
		StateVersion: teeutils.ToHash(config.Version),
		State: types.State{
			HasAPIKey: config.OpenWeatherMapAPIKey != "",
		},
	}

	err := json.NewEncoder(w).Encode(stateResponse)
	if err != nil {
		http.Error(w, fmt.Sprintf("sending response: %v", err), http.StatusInternalServerError)
		return
	}
}

// processAction parses the extension action and routes it to the appropriate processor.
func (e *Extension) processAction(action teetypes.Action) (int, []byte) {
	dataFixed, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
	if err != nil {
		return http.StatusBadRequest, []byte(fmt.Sprintf("decoding fixed data: %v", err))
	}

	switch {
	case dataFixed.OPType == teeutils.ToHash(config.OPTypeWeather):
		return e.processWeather(action, dataFixed)

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op type: received %s, expected %s (%s)",
			dataFixed.OPType.Hex(), teeutils.ToHash(config.OPTypeWeather).Hex(), config.OPTypeWeather,
		))
	}
}

// processWeather routes WEATHER instructions by OPCommand (FETCH or SETTLE).
func (e *Extension) processWeather(action teetypes.Action, df *instruction.DataFixed) (int, []byte) {
	switch {
	case df.OPCommand == teeutils.ToHash(config.OPCommandFetch):
		ar := e.processWeatherFetch(action, df)
		b, _ := json.Marshal(ar)
		return http.StatusOK, b

	case df.OPCommand == teeutils.ToHash(config.OPCommandSettle):
		ar := e.processWeatherSettle(action, df)
		b, _ := json.Marshal(ar)
		return http.StatusOK, b

	case df.OPCommand == teeutils.ToHash(config.OPCommandBuy):
		ar := e.processWeatherBuy(action, df)
		b, _ := json.Marshal(ar)
		return http.StatusOK, b

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op command: received %s, expected one of [%s (%s), %s (%s), %s (%s)]",
			df.OPCommand.Hex(),
			teeutils.ToHash(config.OPCommandFetch).Hex(), config.OPCommandFetch,
			teeutils.ToHash(config.OPCommandSettle).Hex(), config.OPCommandSettle,
			teeutils.ToHash(config.OPCommandBuy).Hex(), config.OPCommandBuy,
		))
	}
}

// processWeatherFetch ABI-decodes the GetWeatherMessage struct, queries
// OpenWeatherMap, and returns a JSON-encoded WeatherReport in ActionResult.Data.
func (e *Extension) processWeatherFetch(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	if config.OpenWeatherMapAPIKey == "" {
		return buildResult(action, df, nil, 0, fmt.Errorf("OPENWEATHERMAP_API_KEY is not set"))
	}
	if len(df.OriginalMessage) == 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("originalMessage is empty"))
	}

	req, err := structs.Decode[types.GetWeatherRequest](types.GetWeatherMessageArg, df.OriginalMessage)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding request: %v", err))
	}
	if req.City == "" {
		return buildResult(action, df, nil, 0, fmt.Errorf("city must not be empty"))
	}

	// Redundant, auditability-only re-check — see payment.go. The contract's
	// atomic transferFrom already makes it structurally impossible to reach
	// this point without payment having succeeded.
	if err := verifyFetchPayment(action.Data.ID, req.Payer); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("payment verification failed: %v", err))
	}

	// Fetch the weather report from OpenWeatherMap.
	report, err := fetchWeather(req.City)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("fetch weather: %v", err))
	}

	payload, err := json.Marshal(report)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("encode report: %v", err))
	}

	return buildResult(action, df, payload, 1, nil)
}

// processWeatherSettle ABI-decodes the SettleMessage, fetches the day's rainfall
// from OpenWeatherMap's One Call day_summary endpoint, and returns an ABI-encoded
// settlement — (address contractAddr, uint256 policyId, uint256 precipitationMmE2,
// string date, uint256 rainThresholdMmE2, bool triggered) — which WeatherInsurance.settle() verifies and acts on. The node
// signs the ActionResult; the contract recovers that signature on-chain.
func (e *Extension) processWeatherSettle(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	if config.OpenWeatherMapAPIKey == "" {
		return buildResult(action, df, nil, 0, fmt.Errorf("OPENWEATHERMAP_API_KEY is not set"))
	}
	if len(df.OriginalMessage) == 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("originalMessage is empty"))
	}

	req, err := structs.Decode[types.SettleRequest](types.SettleMessageArg, df.OriginalMessage)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding settle request: %v", err))
	}

	// Redundant, auditability-only re-check — see payment.go. The contract's
	// atomic transferFrom already makes it structurally impossible to reach
	// this point without payment having succeeded.
	if err := verifySettlePayment(action.Data.ID, req.PolicyId, req.Payer); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("payment verification failed: %v", err))
	}

	var (
		coverageDate string
		lat          = req.Lat
		lon          = req.Lon
		threshold    *big.Int
		triggered    bool
	)

	if req.TermsCommitment != (common.Hash{}) {
		e.mu.RLock()
		params, ok := e.privateTerms[req.TermsCommitment]
		e.mu.RUnlock()
		if !ok {
			return buildResult(action, df, nil, 0, fmt.Errorf("unknown private terms commitment"))
		}
		coverageDate = params.Date
		lat = params.Lat
		lon = params.Lon
		threshold = params.RainThresholdMmE2
	} else {
		if req.Date == "" || req.Lat == "" || req.Lon == "" {
			return buildResult(action, df, nil, 0, fmt.Errorf("date/lat/lon must not be empty"))
		}
		coverageDate = req.Date
	}

	canSettle, err := settlementtime.CanSettle(coverageDate, time.Now())
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("coverage date: %v", err))
	}
	if !canSettle {
		return buildResult(action, df, nil, 0, fmt.Errorf("settlement not open yet (after midnight UTC following %s)", coverageDate))
	}

	// Fetch the day's precipitation from OpenWeatherMap's One Call day_summary endpoint.
	precipMmE2, err := fetchDaySummaryPrecipitationMmE2(lat, lon, coverageDate)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("fetch day_summary: %v", err))
	}

	revealedThreshold := big.NewInt(0)
	if req.TermsCommitment != (common.Hash{}) {
		triggered = precipMmE2.Cmp(threshold) >= 0
		revealedThreshold = threshold
	}

	encoded, err := types.SettlementResultArgs.Pack(
		req.ContractAddr,
		req.PolicyId,
		precipMmE2,
		coverageDate,
		revealedThreshold,
		triggered,
	)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("ABI encode settlement: %v", err))
	}

	return buildResult(action, df, encoded, 1, nil)
}

// processWeatherBuy decrypts ECIES ciphertext, validates private buy params, and
// returns them in ActionResult.Data for relayPrivateBuy.
func (e *Extension) processWeatherBuy(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	if len(df.OriginalMessage) == 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("originalMessage is empty"))
	}

	plaintext, err := decryptViaNode(e.signPort, df.OriginalMessage)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decryption failed: %v", err))
	}

	params, err := structs.Decode[types.PrivateBuyParams](types.PrivateBuyParamsArg, plaintext)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding private buy params: %v", err))
	}

	if params.Holder == (common.Address{}) {
		return buildResult(action, df, nil, 0, fmt.Errorf("holder must not be zero"))
	}
	if params.ContractAddr == (common.Address{}) {
		return buildResult(action, df, nil, 0, fmt.Errorf("contractAddr must not be zero"))
	}
	if params.Date == "" {
		return buildResult(action, df, nil, 0, fmt.Errorf("date must not be empty"))
	}
	if params.Premium == nil || params.Premium.Sign() <= 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("premium must be positive"))
	}
	if params.Payout == nil || params.Payout.Sign() <= 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("payout must be positive"))
	}
	if params.RainThresholdMmE2 == nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("rainThresholdMmE2 required"))
	}
	if params.Lat == "" || params.Lon == "" {
		return buildResult(action, df, nil, 0, fmt.Errorf("lat/lon must not be empty"))
	}

	commitment, err := types.PrivateTermsCommitment(params)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("terms commitment: %v", err))
	}
	e.mu.Lock()
	e.privateTerms[commitment] = params
	e.mu.Unlock()

	encoded, err := types.PrivateBuyResultArgs.Pack(
		params.Holder,
		params.ContractAddr,
		params.Date,
		params.RainThresholdMmE2,
		params.Payout,
		params.Premium,
		params.Lat,
		params.Lon,
	)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("ABI encode private buy result: %v", err))
	}

	return buildResult(action, df, encoded, 1, nil)
}
