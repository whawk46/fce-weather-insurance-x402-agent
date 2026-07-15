// Package types contains types that could be useful to other apps when interacting with the weather-insurance extension.
package types

import (
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// GetWeatherRequest is the ABI-decoded payload of a FETCH instruction.
// Matches Solidity `struct GetWeatherMessage { string city; address payer; }`.
type GetWeatherRequest struct {
	City  string         `json:"city"`
	Payer common.Address `json:"payer"`
}

// WeatherReport is the JSON payload returned in ActionResult.Data. It mirrors
// the canonical subset of OpenWeatherMap's "current weather" response.
type WeatherReport struct {
	City        string  `json:"city"`
	Country     string  `json:"country"`
	Description string  `json:"description"`
	TempC       float64 `json:"tempC"`
	FeelsLikeC  float64 `json:"feelsLikeC"`
	HumidityPct int     `json:"humidityPct"`
	PressureHpa int     `json:"pressureHpa"`
	WindMS      float64 `json:"windMS"`
	ObservedAt  int64   `json:"observedAt"` // Unix seconds, from upstream `dt`.
}

// SettleRequest is the ABI-decoded payload of a SETTLE instruction.
// Matches Solidity `struct SettleMessage { uint256 policyId; address contractAddr; string date; string lat; string lon; bytes32 termsCommitment; address payer; }`.
type SettleRequest struct {
	PolicyId        *big.Int       `json:"policyId"`
	ContractAddr    common.Address `json:"contractAddr"`
	Date            string         `json:"date"`
	Lat             string         `json:"lat"`
	Lon             string         `json:"lon"`
	TermsCommitment common.Hash    `json:"termsCommitment"`
	Payer           common.Address `json:"payer"`
}

// PrivateBuyParams is ABI-encoded before ECIES encryption and decoded by the TEE
// after decryption. Matches Solidity `struct PrivateBuyParams`.
type PrivateBuyParams struct {
	Holder            common.Address `json:"holder"`
	ContractAddr      common.Address `json:"contractAddr"`
	Date              string         `json:"date"`
	RainThresholdMmE2 *big.Int       `json:"rainThresholdMmE2"`
	Payout            *big.Int       `json:"payout"`
	Premium           *big.Int       `json:"premium"`
	Lat               string         `json:"lat"`
	Lon               string         `json:"lon"`
}

// PrivateBuyResult is the decoded form of the BUY result payload returned in
// ActionResult.Data and consumed by relayPrivateBuy on-chain.
type PrivateBuyResult struct {
	Holder            common.Address
	ContractAddr      common.Address
	Date              string
	RainThresholdMmE2 *big.Int
	Payout            *big.Int
	Premium           *big.Int
}

// SettlementResult is the decoded form of the SETTLE result payload that the TEE
// returns in ActionResult.Data. On-chain, settle() reads the same fields via
// abi.decode(data, (address, uint256, uint256, string, uint256, bool)).
type SettlementResult struct {
	ContractAddr      common.Address
	PolicyId          *big.Int
	PrecipitationMmE2 *big.Int // precipitation total in mm × 100
	Date              string
	RainThresholdMmE2 *big.Int // revealed threshold (private); 0 for public policies
	Triggered         bool     // TEE threshold comparison (must match precip >= threshold)
}

// GetWeatherMessageArg describes the ABI layout of GetWeatherMessage from the Solidity contract.
var GetWeatherMessageArg abi.Argument

// SettleMessageArg describes the ABI layout of SettleMessage from the Solidity contract.
var SettleMessageArg abi.Argument

// PrivateBuyParamsArg describes the ABI layout of PrivateBuyParams.
var PrivateBuyParamsArg abi.Argument

// PrivateBuyResultArgs is the flat ABI tuple the TEE packs into ActionResult.Data for BUY,
// matching relayPrivateBuy's abi.decode.
var PrivateBuyResultArgs abi.Arguments

// PrivateTermsCommitmentArgs is the flat ABI tuple used by _privateTermsCommitment:
// keccak256(abi.encode(holder, contractAddr, date, rainThresholdMmE2, payout, premium)).
var PrivateTermsCommitmentArgs abi.Arguments

// SettlementResultArgs is the flat ABI tuple the TEE packs into ActionResult.Data,
// matching Solidity abi.decode(data, (address, uint256, uint256, string, uint256, bool)).
var SettlementResultArgs abi.Arguments

func init() {
	getWeatherTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "city", Type: "string"},
		{Name: "payer", Type: "address"},
	})
	GetWeatherMessageArg = abi.Argument{Type: getWeatherTy}

	settleTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "policyId", Type: "uint256"},
		{Name: "contractAddr", Type: "address"},
		{Name: "date", Type: "string"},
		{Name: "lat", Type: "string"},
		{Name: "lon", Type: "string"},
		{Name: "termsCommitment", Type: "bytes32"},
		{Name: "payer", Type: "address"},
	})
	SettleMessageArg = abi.Argument{Type: settleTy}

	privateBuyTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "holder", Type: "address"},
		{Name: "contractAddr", Type: "address"},
		{Name: "date", Type: "string"},
		{Name: "rainThresholdMmE2", Type: "uint256"},
		{Name: "payout", Type: "uint256"},
		{Name: "premium", Type: "uint256"},
		{Name: "lat", Type: "string"},
		{Name: "lon", Type: "string"},
	})
	PrivateBuyParamsArg = abi.Argument{Type: privateBuyTy}

	addressTy, _ := abi.NewType("address", "", nil)
	uintTy, _ := abi.NewType("uint256", "", nil)
	stringTy, _ := abi.NewType("string", "", nil)
	PrivateBuyResultArgs = abi.Arguments{
		{Type: addressTy},
		{Type: addressTy},
		{Type: stringTy},
		{Type: uintTy},
		{Type: uintTy},
		{Type: uintTy},
		{Type: stringTy},
		{Type: stringTy},
	}
	PrivateTermsCommitmentArgs = PrivateBuyResultArgs

	boolTy, _ := abi.NewType("bool", "", nil)
	SettlementResultArgs = abi.Arguments{
		{Type: addressTy},
		{Type: uintTy},
		{Type: uintTy},
		{Type: stringTy},
		{Type: uintTy},
		{Type: boolTy},
	}
}

// PrivateTermsCommitment matches Solidity _privateTermsCommitment / relayPrivateBuy.
func PrivateTermsCommitment(p PrivateBuyParams) (common.Hash, error) {
	encoded, err := PrivateTermsCommitmentArgs.Pack(
		p.Holder,
		p.ContractAddr,
		p.Date,
		p.RainThresholdMmE2,
		p.Payout,
		p.Premium,
		p.Lat,
		p.Lon,
	)
	if err != nil {
		return common.Hash{}, err
	}
	return common.BytesToHash(crypto.Keccak256(encoded)), nil
}

// State holds the extension's observable state, returned by GET /state.
//
// HasAPIKey reports whether the TEE was started with an OpenWeatherMap API
// key in its environment. The key itself is never exposed.
type State struct {
	HasAPIKey bool `json:"hasAPIKey"`
}

// --- DO NOT MODIFY below this line. ---

// StateResponse is the envelope returned by GET /state.
type StateResponse struct {
	StateVersion common.Hash `json:"stateVersion"`
	State        State       `json:"state"`
}
