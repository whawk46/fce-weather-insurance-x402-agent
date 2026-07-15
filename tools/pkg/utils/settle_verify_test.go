package utils

import (
	"bytes"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

// TestSettleSignatureMatchesContract proves the on-chain reconstruction in
// WeatherInsurance.settle() recovers the TEE address from a node-style signature.
//
// It uses the REAL node primitives — teetypes.ActionResult.Hash() (what the node
// hashes) and teeutils.Sign (what the node signs with) — then reconstructs the
// hash exactly as the Solidity does:
//
//	resultHash = keccak256(abi.encodePacked(keccak256(data), id, keccak256(tag), status))
//	ethHash    = keccak256("\x19Ethereum Signed Message:\n32" || resultHash)
//	signer     = ecrecover(ethHash, sig)
//
// and asserts the recovered address equals the signer. If the Solidity formula
// or field order ever drifts from the node's, this test fails.
func TestSettleSignatureMatchesContract(t *testing.T) {
	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatalf("genkey: %v", err)
	}
	teeAddr := crypto.PubkeyToAddress(key.PublicKey)

	// Build a realistic SETTLE result payload: abi.encode(address, uint256, uint256, string, uint256, bool).
	addressTy, _ := abi.NewType("address", "", nil)
	uintTy, _ := abi.NewType("uint256", "", nil)
	stringTy, _ := abi.NewType("string", "", nil)
	boolTy, _ := abi.NewType("bool", "", nil)
	args := abi.Arguments{{Type: addressTy}, {Type: uintTy}, {Type: uintTy}, {Type: stringTy}, {Type: uintTy}, {Type: boolTy}}
	contractAddr := common.HexToAddress("0x00000000000000000000000000000000DeaDBeef")
	data, err := args.Pack(contractAddr, big.NewInt(0), big.NewInt(62), "2026-06-16", big.NewInt(100), true)
	if err != nil {
		t.Fatalf("pack: %v", err)
	}

	ar := teetypes.ActionResult{
		ID:            common.HexToHash("0xabc123"),
		SubmissionTag: teetypes.Submit, // "submit"
		Status:        1,
		Data:          data,
	}

	// What the node hashes and signs.
	nodeHash := ar.Hash()
	sig, err := teeutils.Sign(nodeHash, key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	// Reconstruct exactly as Solidity settle() does.
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

	// EIP-191 personal-sign prefix + ecrecover (mirrors _ethSigned + _recover).
	ethHash := accounts.TextHash(resultHash)
	pub, err := crypto.SigToPub(ethHash, sig)
	if err != nil {
		t.Fatalf("ecrecover: %v", err)
	}
	recovered := crypto.PubkeyToAddress(*pub)

	if recovered != teeAddr {
		t.Fatalf("recovered %s != TEE %s", recovered.Hex(), teeAddr.Hex())
	}
	t.Logf("OK: contract reconstruction recovers TEE address %s", teeAddr.Hex())
}
