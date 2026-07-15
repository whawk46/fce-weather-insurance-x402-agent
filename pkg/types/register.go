package types

import (
	"encoding/hex"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"

	"weather-insurance/pkg/decoder"
)

// RegisterDecoders registers all type decoders for this extension.
// The types-server uses these to render messages and results as human-readable JSON.
func RegisterDecoders(r *decoder.Registry) {
	// FETCH message (ABI-encoded GetWeatherMessage struct)
	r.Register(
		decoder.RegistryKey{OPType: "WEATHER", OPCommand: "FETCH", Kind: decoder.KindMessage},
		decoder.NewABIDecoder[GetWeatherRequest](GetWeatherMessageArg),
	)
	// FETCH result (JSON WeatherReport)
	r.Register(
		decoder.RegistryKey{OPType: "WEATHER", OPCommand: "FETCH", Kind: decoder.KindResult},
		decoder.NewJSONDecoder[WeatherReport](),
	)
	// SETTLE message (ABI-encoded SettleMessage struct)
	r.Register(
		decoder.RegistryKey{OPType: "WEATHER", OPCommand: "SETTLE", Kind: decoder.KindMessage},
		decoder.NewABIDecoder[SettleRequest](SettleMessageArg),
	)
	// SETTLE result (flat ABI tuple: address, uint256, uint256, string)
	r.Register(
		decoder.RegistryKey{OPType: "WEATHER", OPCommand: "SETTLE", Kind: decoder.KindResult},
		settlementResultDecoder{},
	)
	// BUY message (ECIES ciphertext on-chain; types-server reports opaque bytes)
	r.Register(
		decoder.RegistryKey{OPType: "WEATHER", OPCommand: "BUY", Kind: decoder.KindMessage},
		encryptedMessageDecoder{},
	)
	// BUY result (flat ABI tuple for relayPrivateBuy)
	r.Register(
		decoder.RegistryKey{OPType: "WEATHER", OPCommand: "BUY", Kind: decoder.KindResult},
		privateBuyResultDecoder{},
	)
	// BUY plaintext params (for tooling that decodes pre-encryption ABI payloads)
	r.Register(
		decoder.RegistryKey{OPType: "WEATHER", OPCommand: "BUY_PLAINTEXT", Kind: decoder.KindMessage},
		decoder.NewABIDecoder[PrivateBuyParams](PrivateBuyParamsArg),
	)
}

// settlementResultDecoder decodes the flat ABI-encoded settlement result that
// the TEE returns (and that WeatherInsurance.settle decodes on-chain).
type settlementResultDecoder struct{}

type encryptedMessageDecoder struct{}

func (encryptedMessageDecoder) Decode(data []byte) (any, error) {
	return map[string]any{
		"encrypted": true,
		"length":    len(data),
		"hex":       "0x" + hex.EncodeToString(data),
	}, nil
}

type privateBuyResultDecoder struct{}

func (privateBuyResultDecoder) Decode(data []byte) (any, error) {
	vals, err := PrivateBuyResultArgs.Unpack(data)
	if err != nil {
		return nil, err
	}
	if len(vals) != 6 {
		return nil, fmt.Errorf("expected 6 values, got %d", len(vals))
	}
	return PrivateBuyResult{
		Holder:            vals[0].(common.Address),
		ContractAddr:      vals[1].(common.Address),
		Date:              vals[2].(string),
		RainThresholdMmE2: vals[3].(*big.Int),
		Payout:            vals[4].(*big.Int),
		Premium:           vals[5].(*big.Int),
	}, nil
}

func (settlementResultDecoder) Decode(data []byte) (any, error) {
	vals, err := SettlementResultArgs.Unpack(data)
	if err != nil {
		return nil, err
	}
	if len(vals) != 6 {
		return nil, fmt.Errorf("expected 6 values, got %d", len(vals))
	}
	r := SettlementResult{
		Date:              vals[3].(string),
		RainThresholdMmE2: vals[4].(*big.Int),
		Triggered:         vals[5].(bool),
	}
	r.ContractAddr = vals[0].(common.Address)
	r.PolicyId = vals[1].(*big.Int)
	r.PrecipitationMmE2 = vals[2].(*big.Int)
	return r, nil
}
