package utils

import (
	"bytes"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	csigning "github.com/flare-foundation/go-flare-common/pkg/signing"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
	wtypes "weather-insurance/pkg/types"
)

// TestRelayPrivateBuySignatureMatchesContract verifies relayPrivateBuy uses the same
// domain-separated ActionResult signing scheme as settle().
func TestRelayPrivateBuySignatureMatchesContract(t *testing.T) {
	const chainID uint64 = 114

	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatalf("genkey: %v", err)
	}
	teeAddr := crypto.PubkeyToAddress(key.PublicKey)

	holder := common.HexToAddress("0x00000000000000000000000000000000000000b0b")
	contractAddr := common.HexToAddress("0x00000000000000000000000000000000DeaDBeef")
	data, err := wtypes.PrivateBuyResultArgs.Pack(
		holder,
		contractAddr,
		"2026-06-16",
		big.NewInt(100),
		big.NewInt(10),
		big.NewInt(1),
		"52.52",
		"13.405",
	)
	if err != nil {
		t.Fatalf("pack: %v", err)
	}

	ar := teetypes.ActionResult{
		ID:            common.HexToHash("0xabc123"),
		SubmissionTag: teetypes.Submit,
		Status:        1,
		Data:          data,
	}

	nodeHash := ar.Hash()
	payloadHash, err := csigning.NewPayload(csigning.TEEActionResult, chainID, common.BytesToHash(nodeHash)).Hash()
	if err != nil {
		t.Fatalf("payload: %v", err)
	}
	sig, err := teeutils.Sign(payloadHash[:], key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	dataHash := crypto.Keccak256(ar.Data)
	tagHash := crypto.Keccak256([]byte(ar.SubmissionTag))
	packed := make([]byte, 0, 32+32+32+1)
	packed = append(packed, dataHash...)
	packed = append(packed, ar.ID[:]...)
	packed = append(packed, tagHash...)
	packed = append(packed, ar.Status)
	resultHash := crypto.Keccak256(packed)

	if !bytes.Equal(resultHash, nodeHash) {
		t.Fatalf("reconstructed resultHash != node ActionResult.Hash()\n recon=%x\n node =%x", resultHash, nodeHash)
	}

	ethHash := accounts.TextHash(payloadHash[:])
	pub, err := crypto.SigToPub(ethHash, sig)
	if err != nil {
		t.Fatalf("ecrecover: %v", err)
	}
	recovered := crypto.PubkeyToAddress(*pub)

	if recovered != teeAddr {
		t.Fatalf("recovered %s != TEE %s", recovered.Hex(), teeAddr.Hex())
	}
}
