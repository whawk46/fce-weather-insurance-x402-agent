// Package x402 implements the HTTP-visible half of x402 payment gating for
// weather FETCH/SETTLE: a 402 Payment Required response tells the client to
// approve the on-chain feeToken fee, and a retry proceeds once that allowance
// is in place. The actual enforcement is NOT this HTTP layer — it's
// WeatherInsurance.getWeather/requestSettlement themselves, which are
// onlyGateway and pull the fee via transferFrom atomically with the
// instruction. This package is a convenience front door + UX, not the trust
// boundary; the contract is.
package x402

import (
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"

	wtypes "weather-insurance/pkg/types"
	"weather-insurance/tools/pkg/contracts/weather"
	"weather-insurance/tools/pkg/fccutils"
	"weather-insurance/tools/pkg/support"
	instrutils "weather-insurance/tools/pkg/utils"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
)

// Handler serves the x402-gated FETCH/SETTLE endpoints. It holds the
// gateway's own funded wallet (via Support), which must be the contract's
// registered `gateway` address — the only caller getWeather/requestSettlement
// accept.
type Handler struct {
	Support      *support.Support
	Contract     *weather.WeatherInsurance
	ContractAddr common.Address
	ProxyURL     string
	ChainID      *big.Int
	CORSOrigin   string
}

func (h *Handler) withCORS(w http.ResponseWriter) {
	if h.CORSOrigin == "" {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", h.CORSOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func jsonUintString(v any) string {
	switch x := v.(type) {
	case *big.Int:
		return x.String()
	case big.Int:
		return x.String()
	default:
		return fmt.Sprint(v)
	}
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// paymentRequirements is the body of a 402 response: approve `amountBase` of
// `asset` to `spender` (the WeatherInsurance contract itself — it pulls the
// fee via transferFrom when the gateway relays the request), then retry.
type paymentRequirements struct {
	X402Version          int    `json:"x402Version"`
	Resource             string `json:"resource"`
	ChainID              int64  `json:"chainId"`
	Asset                string `json:"asset"`
	Spender              string `json:"spender"`
	AmountBase           string `json:"amountBase"`
	CurrentAllowanceBase string `json:"currentAllowanceBase"`
}

// requirePayment reads the payer's live on-chain allowance to this contract
// and, if it's below `amount`, writes a 402 with approve instructions and
// returns false. Passing this check is advisory — WeatherInsurance's own
// transferFrom is what actually enforces payment when the gateway calls it
// below, so a race between this check and the call just surfaces as a
// reverted transaction, not a bypass.
func (h *Handler) requirePayment(w http.ResponseWriter, resource string, payer common.Address, amount *big.Int) bool {
	if amount.Sign() == 0 {
		return true
	}

	feeToken, err := h.Contract.FeeToken(&bind.CallOpts{})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "reading feeToken: "+err.Error())
		return false
	}
	allowance, err := instrutils.Allowance(h.Support, feeToken, payer, h.ContractAddr)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "reading allowance: "+err.Error())
		return false
	}
	if allowance.Cmp(amount) >= 0 {
		return true
	}

	writeJSON(w, http.StatusPaymentRequired, paymentRequirements{
		X402Version:          1,
		Resource:             resource,
		ChainID:              h.ChainID.Int64(),
		Asset:                feeToken.Hex(),
		Spender:              h.ContractAddr.Hex(),
		AmountBase:           amount.String(),
		CurrentAllowanceBase: allowance.String(),
	})
	return false
}

// --- FETCH ---

type fetchRequestBody struct {
	City  string         `json:"city"`
	Payer common.Address `json:"payer"`
}

func (h *Handler) FetchHandler(w http.ResponseWriter, r *http.Request) {
	h.withCORS(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	var body fetchRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if body.City == "" {
		writeErr(w, http.StatusBadRequest, "city is required")
		return
	}
	if body.Payer == (common.Address{}) {
		writeErr(w, http.StatusBadRequest, "payer is required")
		return
	}

	fetchFee, err := h.Contract.FetchFee(&bind.CallOpts{})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "reading fetchFee: "+err.Error())
		return
	}
	if !h.requirePayment(w, "/x402/weather/fetch", body.Payer, fetchFee) {
		return
	}

	instructionID, requestTx, err := instrutils.SendGetWeather(h.Support, h.ContractAddr, body.Payer, body.City)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "sendGetWeather: "+err.Error())
		return
	}
	resp, err := fccutils.ActionResult(h.ProxyURL, instructionID)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "poll fetch result: "+err.Error())
		return
	}
	if resp.Result.Status != 1 {
		writeErr(w, http.StatusBadGateway, "TEE FETCH failed: "+resp.Result.Log)
		return
	}

	var report wtypes.WeatherReport
	if err := json.Unmarshal(resp.Result.Data, &report); err != nil {
		writeErr(w, http.StatusInternalServerError, "decoding weather report: "+err.Error())
		return
	}

	logger.Infof("[x402] fetch served payer=%s city=%q fee=%s", body.Payer.Hex(), body.City, fetchFee.String())
	writeJSON(w, http.StatusOK, map[string]any{
		"instructionId": instructionID.Hex(),
		"requestTx":     requestTx.Hex(),
		"report":        report,
	})
}

// --- SETTLE ---

type settleRequestBody struct {
	PolicyId string         `json:"policyId"`
	Payer    common.Address `json:"payer"`
}

func (h *Handler) SettleHandler(w http.ResponseWriter, r *http.Request) {
	h.withCORS(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	var body settleRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	policyId, ok := new(big.Int).SetString(body.PolicyId, 10)
	if !ok {
		writeErr(w, http.StatusBadRequest, "policyId is required and must be a base-10 integer string")
		return
	}
	if body.Payer == (common.Address{}) {
		writeErr(w, http.StatusBadRequest, "payer is required")
		return
	}

	settleFee, err := h.Contract.SettleFee(&bind.CallOpts{})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "reading settleFee: "+err.Error())
		return
	}
	if !h.requirePayment(w, "/x402/weather/settle", body.Payer, settleFee) {
		return
	}

	settleTx, resp, err := instrutils.RequestAndRelaySettlement(h.Support, h.ContractAddr, body.Payer, h.ProxyURL, policyId)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "settlement: "+err.Error())
		return
	}

	result, err := wtypes.SettlementResultArgs.Unpack(resp.Result.Data)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "decoding settlement result: "+err.Error())
		return
	}

	logger.Infof("[x402] settle served payer=%s policyId=%s fee=%s", body.Payer.Hex(), policyId.String(), settleFee.String())
	writeJSON(w, http.StatusOK, map[string]any{
		"settleTx":              settleTx.Hex(),
		"precipitationMmE2":     jsonUintString(result[2]),
		"date":                  result[3],
		"revealedThresholdMmE2": jsonUintString(result[4]),
		"triggered":             result[5],
	})
}
