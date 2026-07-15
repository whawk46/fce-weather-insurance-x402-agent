package extension

import (
	"context"
	"testing"

	"weather-insurance/internal/config"

	"github.com/ethereum/go-ethereum/common"
	ethtypes "github.com/ethereum/go-ethereum/core/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

type fakeReceiptFetcher struct {
	receipt *ethtypes.Receipt
	err     error
}

func (f *fakeReceiptFetcher) TransactionReceipt(ctx context.Context, txHash common.Hash) (*ethtypes.Receipt, error) {
	return f.receipt, f.err
}

func feeCollectedLog(contract, payer common.Address, kind common.Hash) *ethtypes.Log {
	return &ethtypes.Log{
		Address: contract,
		Topics: []common.Hash{
			feeCollectedTopic,
			common.BytesToHash(payer.Bytes()),
			kind,
		},
	}
}

var (
	testContract = common.HexToAddress("0x1111111111111111111111111111111111111111")
	testPayer    = common.HexToAddress("0x2222222222222222222222222222222222222222")
	fetchKind    = teeutils.ToHash(config.OPCommandFetch)
	settleKind   = teeutils.ToHash(config.OPCommandSettle)
)

func withInstructionSender(t *testing.T, addr common.Address) {
	t.Helper()
	orig := config.InstructionSender
	config.InstructionSender = addr
	t.Cleanup(func() { config.InstructionSender = orig })
}

func TestVerifyFeeCollectedInTxSucceeds(t *testing.T) {
	receipt := &ethtypes.Receipt{Logs: []*ethtypes.Log{feeCollectedLog(testContract, testPayer, fetchKind)}}
	client := &fakeReceiptFetcher{receipt: receipt}
	withInstructionSender(t, testContract)

	if err := verifyFeeCollectedInTx(client, common.HexToHash("0xaa"), testPayer, fetchKind); err != nil {
		t.Fatalf("expected success, got %s", err)
	}
}

func TestVerifyFeeCollectedInTxRejectsWrongPayer(t *testing.T) {
	otherPayer := common.HexToAddress("0x3333333333333333333333333333333333333333")
	receipt := &ethtypes.Receipt{Logs: []*ethtypes.Log{feeCollectedLog(testContract, otherPayer, fetchKind)}}
	client := &fakeReceiptFetcher{receipt: receipt}
	withInstructionSender(t, testContract)

	if err := verifyFeeCollectedInTx(client, common.HexToHash("0xaa"), testPayer, fetchKind); err == nil {
		t.Fatalf("expected failure for mismatched payer")
	}
}

func TestVerifyFeeCollectedInTxRejectsWrongKind(t *testing.T) {
	receipt := &ethtypes.Receipt{Logs: []*ethtypes.Log{feeCollectedLog(testContract, testPayer, settleKind)}}
	client := &fakeReceiptFetcher{receipt: receipt}
	withInstructionSender(t, testContract)

	if err := verifyFeeCollectedInTx(client, common.HexToHash("0xaa"), testPayer, fetchKind); err == nil {
		t.Fatalf("expected failure for mismatched kind (settle log presented for a fetch check)")
	}
}

func TestVerifyFeeCollectedInTxRejectsLogFromOtherContract(t *testing.T) {
	otherContract := common.HexToAddress("0x4444444444444444444444444444444444444444")
	receipt := &ethtypes.Receipt{Logs: []*ethtypes.Log{feeCollectedLog(otherContract, testPayer, fetchKind)}}
	client := &fakeReceiptFetcher{receipt: receipt}
	withInstructionSender(t, testContract)

	if err := verifyFeeCollectedInTx(client, common.HexToHash("0xaa"), testPayer, fetchKind); err == nil {
		t.Fatalf("expected failure when the log was emitted by a different contract")
	}
}

func TestVerifyFeeCollectedInTxRejectsMissingLog(t *testing.T) {
	receipt := &ethtypes.Receipt{Logs: nil}
	client := &fakeReceiptFetcher{receipt: receipt}
	withInstructionSender(t, testContract)

	if err := verifyFeeCollectedInTx(client, common.HexToHash("0xaa"), testPayer, fetchKind); err == nil {
		t.Fatalf("expected failure when no FeeCollected log is present")
	}
}

func TestSettlementRequestedDataArgDecodesInstructionId(t *testing.T) {
	instructionID := common.HexToHash("0xdeadbeef")
	encoded, err := settlementRequestedDataArg.Pack(instructionID)
	if err != nil {
		t.Fatalf("pack: %s", err)
	}
	vals, err := settlementRequestedDataArg.UnpackValues(encoded)
	if err != nil {
		t.Fatalf("unpack: %s", err)
	}
	raw, ok := vals[0].([32]byte)
	if !ok {
		t.Fatalf("unexpected decoded type %T", vals[0])
	}
	if common.Hash(raw) != instructionID {
		t.Fatalf("roundtrip mismatch: got %s want %s", common.Hash(raw).Hex(), instructionID.Hex())
	}
}
