package types

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/tee/structs"
)

func TestPrivateTermsCommitment_matchesFlatABIEncode(t *testing.T) {
	holder := common.HexToAddress("0x00000000000000000000000000000000000000b0b")
	contractAddr := common.HexToAddress("0xB2eFeD249E44cE686811Aa1B9db0e7fD3a7cf941")
	payout, _ := new(big.Int).SetString("10000000000000000000", 10)
	premium, _ := new(big.Int).SetString("1000000000000000000", 10)
	params := PrivateBuyParams{
		Holder:            holder,
		ContractAddr:      contractAddr,
		Date:              "2026-05-26",
		RainThresholdMmE2: big.NewInt(1),
		Payout:            payout,
		Premium:           premium,
		Lat:               "52.52",
		Lon:               "13.405",
	}

	got, err := PrivateTermsCommitment(params)
	if err != nil {
		t.Fatalf("PrivateTermsCommitment: %v", err)
	}

	flat, err := PrivateTermsCommitmentArgs.Pack(
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
		t.Fatalf("Pack: %v", err)
	}
	want := common.BytesToHash(crypto.Keccak256(flat))
	if got != want {
		t.Fatalf("commitment mismatch:\n got  %s\n want %s", got.Hex(), want.Hex())
	}

	// Regression guard: tuple encoding (structs.Encode) used to differ from flat abi.encode.
	tupleEncoded, err := structs.Encode(PrivateBuyParamsArg, params)
	if err != nil {
		t.Fatalf("structs.Encode: %v", err)
	}
	if common.BytesToHash(crypto.Keccak256(tupleEncoded)) == got {
		t.Fatal("commitment must not use tuple encoding")
	}
}
