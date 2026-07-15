package extension

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"sync"

	"weather-insurance/internal/config"

	goethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	ethtypes "github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

// Event topic0 hashes used to locate the on-chain transaction behind an
// instruction. These are event *signature* hashes (keccak256 of the
// signature string), unrelated to teeutils.ToHash (plain bytes32 padding),
// which is used for OPCommand/fee "kind" values below.
var (
	weatherRequestedTopic    = crypto.Keccak256Hash([]byte("WeatherRequested(bytes32,address)"))
	settlementRequestedTopic = crypto.Keccak256Hash([]byte("SettlementRequested(uint256,bytes32)"))
	feeCollectedTopic        = crypto.Keccak256Hash([]byte("FeeCollected(address,uint256,bytes32)"))
)

const feesABI = `[
  {"name":"fetchFee","type":"function","stateMutability":"view","inputs":[],"outputs":[{"name":"","type":"uint256"}]},
  {"name":"settleFee","type":"function","stateMutability":"view","inputs":[],"outputs":[{"name":"","type":"uint256"}]}
]`

var settlementRequestedDataArg = abi.Arguments{{Type: mustABIType("bytes32")}}

func mustABIType(t string) abi.Type {
	typ, err := abi.NewType(t, "", nil)
	if err != nil {
		panic(err)
	}
	return typ
}

var (
	paymentClientOnce sync.Once
	paymentClient     *ethclient.Client
	paymentClientErr  error
)

func chainClient() (*ethclient.Client, error) {
	paymentClientOnce.Do(func() {
		paymentClient, paymentClientErr = ethclient.Dial(config.ChainURL)
	})
	return paymentClient, paymentClientErr
}

// logSearchBlockRange bounds eth_getLogs queries to a recent window — public
// RPC providers cap the range (e.g. Coston2's public endpoint rejects queries
// spanning more than 30 blocks), and the request being verified always just
// happened, so a small recent window is sufficient.
const logSearchBlockRange = 25

// recentBlockRange returns a [from, to] window ending at the latest block,
// bounded to logSearchBlockRange blocks so providers don't reject the query.
func recentBlockRange(client *ethclient.Client) (from, to *big.Int, err error) {
	latest, err := client.BlockNumber(context.Background())
	if err != nil {
		return nil, nil, fmt.Errorf("read latest block: %w", err)
	}
	fromBlock := int64(latest) - logSearchBlockRange
	if fromBlock < 0 {
		fromBlock = 0
	}
	return big.NewInt(fromBlock), big.NewInt(int64(latest)), nil
}

func feesContract(client *ethclient.Client) (*bind.BoundContract, error) {
	parsed, err := abi.JSON(strings.NewReader(feesABI))
	if err != nil {
		return nil, err
	}
	return bind.NewBoundContract(config.InstructionSender, parsed, client, client, client), nil
}

func readFee(client *ethclient.Client, method string) (*big.Int, error) {
	c, err := feesContract(client)
	if err != nil {
		return nil, err
	}
	var out []interface{}
	if err := c.Call(&bind.CallOpts{}, &out, method); err != nil {
		return nil, err
	}
	if len(out) != 1 {
		return nil, fmt.Errorf("%s: unexpected output", method)
	}
	fee, ok := out[0].(*big.Int)
	if !ok {
		return nil, fmt.Errorf("%s: unexpected return type", method)
	}
	return fee, nil
}

// receiptFetcher is the subset of *ethclient.Client verifyFeeCollectedInTx
// needs — kept as an interface so tests can supply a fixture.
type receiptFetcher interface {
	TransactionReceipt(ctx context.Context, txHash common.Hash) (*ethtypes.Receipt, error)
}

var _ receiptFetcher = (*ethclient.Client)(nil)

// verifyFeeCollectedInTx confirms `txHash` contains a FeeCollected(payer, _, kind)
// log emitted by the WeatherInsurance contract.
func verifyFeeCollectedInTx(client receiptFetcher, txHash common.Hash, payer common.Address, kind common.Hash) error {
	receipt, err := client.TransactionReceipt(context.Background(), txHash)
	if err != nil {
		return fmt.Errorf("fetch tx receipt: %w", err)
	}
	for _, log := range receipt.Logs {
		if log == nil || log.Address != config.InstructionSender {
			continue
		}
		if len(log.Topics) != 3 || log.Topics[0] != feeCollectedTopic {
			continue
		}
		logPayer := common.BytesToAddress(log.Topics[1].Bytes())
		if logPayer == payer && log.Topics[2] == kind {
			return nil
		}
	}
	return fmt.Errorf("no FeeCollected(payer=%s, kind=%s) log found in tx %s", payer.Hex(), kind.Hex(), txHash.Hex())
}

// verifyFetchPayment is a redundant, auditability-only re-check: the
// contract's atomic transferFrom inside _collectFee already makes it
// impossible for the TEE to ever receive this instruction unless payment
// succeeded — a failed transferFrom reverts the entire transaction,
// including the sendInstructions call that enqueues this instruction. This
// re-derives that fact from chain data so a reviewer of the TEE code alone
// doesn't have to trust that invariant elsewhere; it is NOT what actually
// enforces payment.
func verifyFetchPayment(instructionID common.Hash, payer common.Address) error {
	if config.InstructionSender == (common.Address{}) {
		return fmt.Errorf("INSTRUCTION_SENDER not configured — cannot verify payment")
	}
	client, err := chainClient()
	if err != nil {
		return fmt.Errorf("dial chain: %w", err)
	}

	fee, err := readFee(client, "fetchFee")
	if err != nil {
		return fmt.Errorf("read fetchFee: %w", err)
	}
	if fee.Sign() == 0 {
		return nil // fee disabled — nothing to verify, matches _collectFee's no-op
	}

	fromBlock, toBlock, err := recentBlockRange(client)
	if err != nil {
		return err
	}
	logs, err := client.FilterLogs(context.Background(), goethereum.FilterQuery{
		FromBlock: fromBlock,
		ToBlock:   toBlock,
		Addresses: []common.Address{config.InstructionSender},
		Topics:    [][]common.Hash{{weatherRequestedTopic}, {instructionID}},
	})
	if err != nil {
		return fmt.Errorf("filter WeatherRequested logs: %w", err)
	}
	if len(logs) == 0 {
		return fmt.Errorf("no WeatherRequested log found for instruction %s", instructionID.Hex())
	}

	return verifyFeeCollectedInTx(client, logs[0].TxHash, payer, teeutils.ToHash(config.OPCommandFetch))
}

// verifySettlePayment mirrors verifyFetchPayment for SETTLE. SettlementRequested's
// instructionId is a pre-existing, non-indexed field (kept as-is rather than
// changing an event other code already decodes), so requests are found by the
// indexed policyId and disambiguated by decoding instructionId from each
// match's data.
func verifySettlePayment(instructionID common.Hash, policyId *big.Int, payer common.Address) error {
	if config.InstructionSender == (common.Address{}) {
		return fmt.Errorf("INSTRUCTION_SENDER not configured — cannot verify payment")
	}
	client, err := chainClient()
	if err != nil {
		return fmt.Errorf("dial chain: %w", err)
	}

	fee, err := readFee(client, "settleFee")
	if err != nil {
		return fmt.Errorf("read settleFee: %w", err)
	}
	if fee.Sign() == 0 {
		return nil // fee disabled — nothing to verify
	}

	fromBlock, toBlock, err := recentBlockRange(client)
	if err != nil {
		return err
	}
	policyIdTopic := common.BigToHash(policyId)
	logs, err := client.FilterLogs(context.Background(), goethereum.FilterQuery{
		FromBlock: fromBlock,
		ToBlock:   toBlock,
		Addresses: []common.Address{config.InstructionSender},
		Topics:    [][]common.Hash{{settlementRequestedTopic}, {policyIdTopic}},
	})
	if err != nil {
		return fmt.Errorf("filter SettlementRequested logs: %w", err)
	}

	var txHash common.Hash
	found := false
	for _, log := range logs {
		vals, err := settlementRequestedDataArg.UnpackValues(log.Data)
		if err != nil || len(vals) != 1 {
			continue
		}
		raw, ok := vals[0].([32]byte)
		if !ok {
			continue
		}
		if common.Hash(raw) == instructionID {
			txHash = log.TxHash
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("no SettlementRequested log found for instruction %s (policy %s)", instructionID.Hex(), policyId.String())
	}

	return verifyFeeCollectedInTx(client, txHash, payer, teeutils.ToHash(config.OPCommandSettle))
}
