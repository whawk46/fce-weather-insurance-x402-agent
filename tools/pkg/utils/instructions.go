package utils

import (
	"context"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"time"

	wtypes "weather-insurance/pkg/types"
	"weather-insurance/tools/pkg/contracts/link"
	"weather-insurance/tools/pkg/contracts/settlementtime"
	"weather-insurance/tools/pkg/contracts/weather"
	"weather-insurance/tools/pkg/fccutils"
	"weather-insurance/tools/pkg/support"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/flare-foundation/go-flare-common/pkg/tee/structs"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	"github.com/pkg/errors"
)

// DefaultFee is the default fee paid with each instruction.
// Override via FEE_WEI env var.
var DefaultFee = big.NewInt(1_000_000_000_000)

func init() {
	if feeStr := os.Getenv("FEE_WEI"); feeStr != "" {
		if fee, ok := new(big.Int).SetString(feeStr, 10); ok {
			DefaultFee = fee
		}
	}
}

// DeployInstructionSender deploys SettlementTime library then WeatherInsurance (linked).
func DeployInstructionSender(s *support.Support) (common.Address, *weather.WeatherInsurance, error) {
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Address{}, nil, errors.Errorf("failed to create transactor: %s", err)
	}

	libAddr, err := deploySettlementTimeLibrary(s, opts)
	if err != nil {
		return common.Address{}, nil, err
	}

	root := support.ProjectRoot()
	artifact := filepath.Join(root, "out", "InstructionSender.sol", "WeatherInsurance.json")
	linked, err := link.LinkBytecodeFromArtifact(artifact, map[string]common.Address{
		"contracts/SettlementTime.sol:SettlementTime": libAddr,
	})
	if err != nil {
		return common.Address{}, nil, errors.Errorf("link WeatherInsurance bytecode: %s", err)
	}

	parsed, err := weather.WeatherInsuranceMetaData.GetAbi()
	if err != nil {
		return common.Address{}, nil, errors.Errorf("parse WeatherInsurance ABI: %s", err)
	}

	// Both registry args are the FlareTeeManager diamond proxy.
	address, tx, _, err := bind.DeployContract(
		opts, *parsed, linked, s.ChainClient, s.Addresses.FlareTeeManager, s.Addresses.FlareTeeManager,
	)
	if err != nil {
		return common.Address{}, nil, errors.Errorf("failed to deploy contract: %s", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	receipt, err := bind.WaitMined(ctx, s.ChainClient, tx)
	if err != nil {
		return common.Address{}, nil, errors.Errorf("deployment tx not mined within 2 minutes (tx: %s): %s", tx.Hash().Hex(), err)
	}

	if receipt.Status != types.ReceiptStatusSuccessful {
		return common.Address{}, nil, errors.New("contract deployment failed")
	}

	wi, err := weather.NewWeatherInsurance(address, s.ChainClient)
	if err != nil {
		return common.Address{}, nil, errors.Errorf("bind deployed WeatherInsurance: %s", err)
	}
	return address, wi, nil
}

func deploySettlementTimeLibrary(s *support.Support, opts *bind.TransactOpts) (common.Address, error) {
	parsed, err := settlementtime.SettlementTimeMetaData.GetAbi()
	if err != nil {
		return common.Address{}, errors.Errorf("parse SettlementTime ABI: %s", err)
	}
	bin := common.FromHex(settlementtime.SettlementTimeBin)
	address, tx, _, err := bind.DeployContract(opts, *parsed, bin, s.ChainClient)
	if err != nil {
		return common.Address{}, errors.Errorf("deploy SettlementTime library: %s", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	receipt, err := bind.WaitMined(ctx, s.ChainClient, tx)
	if err != nil {
		return common.Address{}, errors.Errorf("SettlementTime deploy not mined: %s", err)
	}
	if receipt.Status != types.ReceiptStatusSuccessful {
		return common.Address{}, errors.New("SettlementTime library deployment failed")
	}
	logger.Infof("SettlementTime library deployed at: %s", address.Hex())
	return address, nil
}

// SetExtensionId calls setExtensionId on the InstructionSender contract.
func SetExtensionId(s *support.Support, instructionSenderAddress common.Address) error {
	sender, err := weather.NewWeatherInsurance(instructionSenderAddress, s.ChainClient)
	if err != nil {
		return errors.Errorf("failed to bind contract: %s", err)
	}

	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return errors.Errorf("failed to create transactor: %s", err)
	}

	tx, err := sender.SetExtensionId(opts)
	if err != nil {
		reason := fccutils.DecodeRevertReason(err)
		if reason == "" {
			parsed, _ := weather.WeatherInsuranceMetaData.GetAbi()
			if parsed != nil {
				callData, packErr := parsed.Pack("setExtensionId")
				if packErr == nil {
					from := crypto.PubkeyToAddress(s.Prv.PublicKey)
					reason = fccutils.SimulateAndDecodeRevert(
						s.ChainClient, from, instructionSenderAddress, nil, callData,
					)
				}
			}
		}
		if reason != "" {
			return errors.Errorf("failed to call setExtensionId: %s (revert reason: %s)", err, reason)
		}
		return errors.Errorf("failed to call setExtensionId: %s", err)
	}

	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return errors.Errorf("failed waiting for transaction: %s", err)
	}

	if receipt.Status != types.ReceiptStatusSuccessful {
		parsed, _ := weather.WeatherInsuranceMetaData.GetAbi()
		if parsed != nil {
			callData, packErr := parsed.Pack("setExtensionId")
			if packErr == nil {
				from := crypto.PubkeyToAddress(s.Prv.PublicKey)
				reason := fccutils.SimulateAndDecodeRevert(
					s.ChainClient, from, instructionSenderAddress, nil, callData,
				)
				if reason != "" {
					return errors.Errorf("setExtensionId transaction failed (revert reason: %s)", reason)
				}
			}
		}
		return errors.New("setExtensionId transaction failed")
	}

	return nil
}

// SendGetWeather sends a getWeather instruction via the InstructionSender.
// Returns (instructionId, txHash). s.Prv must be the contract's registered
// gateway address (setGateway) — getWeather is onlyGateway. payer is who the
// on-chain fetchFee (if any) is charged to; payer must have approved this
// contract for at least fetchFee of feeToken beforehand.
func SendGetWeather(s *support.Support, instructionSenderAddress, payer common.Address, city string) (common.Hash, common.Hash, error) {
	sender, err := weather.NewWeatherInsurance(instructionSenderAddress, s.ChainClient)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to bind contract: %s", err)
	}

	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to create transactor: %s", err)
	}
	opts.Value = DefaultFee

	tx, err := sender.GetWeather(opts, city, payer)
	if err != nil {
		reason := fccutils.DecodeRevertReason(err)
		if reason == "" {
			parsed, _ := weather.WeatherInsuranceMetaData.GetAbi()
			if parsed != nil {
				callData, packErr := parsed.Pack("getWeather", city, payer)
				if packErr == nil {
					from := crypto.PubkeyToAddress(s.Prv.PublicKey)
					reason = fccutils.SimulateAndDecodeRevert(
						s.ChainClient, from, instructionSenderAddress, DefaultFee, callData,
					)
				}
			}
		}
		if reason != "" {
			return common.Hash{}, common.Hash{}, errors.Errorf("failed to send getWeather: %s (revert reason: %s)", err, reason)
		}
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to send getWeather: %s", err)
	}

	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed waiting for transaction: %s", err)
	}
	if receipt.Status != 1 {
		return common.Hash{}, common.Hash{}, errors.Errorf("getWeather transaction failed with status: %d", receipt.Status)
	}
	if len(receipt.Logs) == 0 {
		return common.Hash{}, common.Hash{}, errors.New("no logs found in receipt")
	}

	instructionId, err := parseInstructionSent(s, receipt)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to parse TeeInstructionsSent event: %s", err)
	}
	return instructionId, receipt.TxHash, nil
}

// SetPayToken sets the ERC-20 used for premiums and payouts. Owner only.
func SetPayToken(s *support.Support, contractAddr, token common.Address) error {
	c, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		return errors.Errorf("failed to bind contract: %s", err)
	}
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return errors.Errorf("failed to create transactor: %s", err)
	}
	tx, err := c.SetPayToken(opts, token)
	if err != nil {
		return errors.Errorf("setPayToken: %s", err)
	}
	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return errors.Errorf("failed waiting for setPayToken: %s", err)
	}
	if receipt.Status != 1 {
		return errors.Errorf("setPayToken failed with status %d", receipt.Status)
	}
	return nil
}

// BuyPolicy approves the premium in payToken, then buys a rainfall policy.
// payout must be covered by the contract's unreserved liquidity. Returns the new policyId.
func BuyPolicy(s *support.Support, contractAddr, token common.Address, date string, rainThresholdMmE2, payout, premium *big.Int, lat, lon string) (*big.Int, error) {
	if err := Approve(s, token, contractAddr, premium); err != nil {
		return nil, errors.Errorf("approve premium: %s", err)
	}

	c, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		return nil, errors.Errorf("failed to bind contract: %s", err)
	}
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return nil, errors.Errorf("failed to create transactor: %s", err)
	}

	tx, err := c.BuyPolicy(opts, date, rainThresholdMmE2, payout, premium, lat, lon)
	if err != nil {
		return nil, errors.Errorf("buyPolicy: %s (%s)", err, simulateRevert(s, contractAddr, nil, "buyPolicy", date, rainThresholdMmE2, payout, premium, lat, lon))
	}
	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return nil, errors.Errorf("failed waiting for buyPolicy: %s", err)
	}
	if receipt.Status != 1 {
		return nil, errors.Errorf("buyPolicy failed with status %d", receipt.Status)
	}

	// policyId = policyCount() - 1 after the buy.
	count, err := c.PolicyCount(&bind.CallOpts{})
	if err != nil {
		return nil, errors.Errorf("policyCount: %s", err)
	}
	return new(big.Int).Sub(count, big.NewInt(1)), nil
}

// BuildPrivateBuyCiphertext ABI-encodes private buy params and ECIES-encrypts them
// under the TEE public key from the extension proxy /info endpoint.
func BuildPrivateBuyCiphertext(
	proxyURL string,
	contractAddr, holder common.Address,
	date string,
	rainThresholdMmE2, payout, premium *big.Int,
	lat, lon string,
) ([]byte, error) {
	params := wtypes.PrivateBuyParams{
		Holder:            holder,
		ContractAddr:      contractAddr,
		Date:              date,
		RainThresholdMmE2: rainThresholdMmE2,
		Payout:            payout,
		Premium:           premium,
		Lat:               lat,
		Lon:               lon,
	}
	plaintext, err := structs.Encode(wtypes.PrivateBuyParamsArg, params)
	if err != nil {
		return nil, errors.Errorf("encode private buy params: %s", err)
	}

	pub, err := fccutils.TeeECIESPublicKey(proxyURL)
	if err != nil {
		return nil, err
	}
	return fccutils.EncryptForTee(pub, plaintext)
}

// SendPrivateBuy submits buyPolicyPrivate with ECIES ciphertext and returns the instruction ID.
func SendPrivateBuy(s *support.Support, contractAddr common.Address, ciphertext []byte) (common.Hash, common.Hash, error) {
	c, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to bind contract: %s", err)
	}
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to create transactor: %s", err)
	}
	opts.Value = DefaultFee

	tx, err := c.BuyPolicyPrivate(opts, ciphertext)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("buyPolicyPrivate: %s (%s)", err, simulateRevert(s, contractAddr, DefaultFee, "buyPolicyPrivate", ciphertext))
	}
	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed waiting for buyPolicyPrivate: %s", err)
	}
	if receipt.Status != 1 {
		return common.Hash{}, common.Hash{}, errors.Errorf("buyPolicyPrivate failed with status %d", receipt.Status)
	}
	if len(receipt.Logs) == 0 {
		return common.Hash{}, common.Hash{}, errors.New("no logs found in receipt")
	}
	instructionId, err := parseInstructionSent(s, receipt)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to parse TeeInstructionsSent event: %s", err)
	}
	return instructionId, receipt.TxHash, nil
}

// RelayPrivateBuy finalizes a private buy using the TEE-signed ActionResult from the BUY instruction.
func RelayPrivateBuy(
	s *support.Support,
	contractAddr common.Address,
	resultData []byte,
	actionID common.Hash,
	submissionTag string,
	status uint8,
	signature []byte,
) (*big.Int, common.Hash, error) {
	c, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		return nil, common.Hash{}, errors.Errorf("failed to bind contract: %s", err)
	}
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return nil, common.Hash{}, errors.Errorf("failed to create transactor: %s", err)
	}

	tx, err := c.RelayPrivateBuy(opts, resultData, actionID, submissionTag, status, signature)
	if err != nil {
		return nil, common.Hash{}, errors.Errorf("relayPrivateBuy: %s (%s)", err, simulateRevert(s, contractAddr, nil, "relayPrivateBuy", resultData, actionID, submissionTag, status, signature))
	}
	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return nil, common.Hash{}, errors.Errorf("failed waiting for relayPrivateBuy: %s", err)
	}
	if receipt.Status != 1 {
		return nil, common.Hash{}, errors.Errorf("relayPrivateBuy failed with status %d", receipt.Status)
	}

	count, err := c.PolicyCount(&bind.CallOpts{})
	if err != nil {
		return nil, receipt.TxHash, errors.Errorf("policyCount: %s", err)
	}
	policyId := new(big.Int).Sub(count, big.NewInt(1))
	return policyId, receipt.TxHash, nil
}

// RequestAndRelayPrivateBuy runs the private buy flow: encrypt params, send buyPolicyPrivate,
// poll the proxy, and relayPrivateBuy on-chain.
func RequestAndRelayPrivateBuy(
	s *support.Support,
	contractAddr common.Address,
	proxyURL string,
	holder common.Address,
	date string,
	rainThresholdMmE2, payout, premium *big.Int,
	lat, lon string,
) (*big.Int, common.Hash, *teetypes.ActionResponse, error) {
	ciphertext, err := BuildPrivateBuyCiphertext(proxyURL, contractAddr, holder, date, rainThresholdMmE2, payout, premium, lat, lon)
	if err != nil {
		return nil, common.Hash{}, nil, errors.Errorf("build ciphertext: %s", err)
	}

	c, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		return nil, common.Hash{}, nil, errors.Errorf("failed to bind contract: %s", err)
	}
	token, err := c.PayToken(&bind.CallOpts{})
	if err != nil {
		return nil, common.Hash{}, nil, errors.Errorf("payToken: %s", err)
	}
	if err := Approve(s, token, contractAddr, premium); err != nil {
		return nil, common.Hash{}, nil, errors.Errorf("approve premium: %s", err)
	}

	instructionID, buyTx, err := SendPrivateBuy(s, contractAddr, ciphertext)
	if err != nil {
		return nil, common.Hash{}, nil, errors.Errorf("buyPolicyPrivate: %s", err)
	}
	logger.Infof("[private-buy] instruction sent id=%s tx=%s", instructionID.Hex(), buyTx.Hex())

	resp, err := fccutils.ActionResult(proxyURL, instructionID)
	if err != nil {
		return nil, common.Hash{}, nil, errors.Errorf("poll private buy result: %s", err)
	}
	if resp.Result.Status != 1 {
		return nil, common.Hash{}, resp, errors.Errorf("TEE private buy failed: %s", resp.Result.Log)
	}

	policyId, relayTx, err := RelayPrivateBuy(
		s,
		contractAddr,
		resp.Result.Data,
		resp.Result.ID,
		string(resp.Result.SubmissionTag),
		resp.Result.Status,
		resp.Signature,
	)
	if err != nil {
		return nil, common.Hash{}, resp, errors.Errorf("relayPrivateBuy: %s", err)
	}
	logger.Infof("[private-buy] relay complete policyId=%s tx=%s", policyId, relayTx.Hex())
	return policyId, relayTx, resp, nil
}
func FundPool(s *support.Support, contractAddr, token common.Address, amount *big.Int) error {
	if err := Approve(s, token, contractAddr, amount); err != nil {
		return errors.Errorf("approve fund: %s", err)
	}

	c, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		return errors.Errorf("failed to bind contract: %s", err)
	}
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return errors.Errorf("failed to create transactor: %s", err)
	}

	tx, err := c.FundPool(opts, amount)
	if err != nil {
		return errors.Errorf("fundPool: %s (%s)", err, simulateRevert(s, contractAddr, nil, "fundPool", amount))
	}
	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return errors.Errorf("failed waiting for fundPool: %s", err)
	}
	if receipt.Status != 1 {
		return errors.Errorf("fundPool failed with status %d", receipt.Status)
	}
	return nil
}

// SetTeeAddress registers the active TEE signing address on the contract.
func SetTeeAddress(s *support.Support, contractAddr, teeAddr common.Address) error {
	c, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		return errors.Errorf("failed to bind contract: %s", err)
	}
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return errors.Errorf("failed to create transactor: %s", err)
	}
	tx, err := c.SetTeeAddress(opts, teeAddr)
	if err != nil {
		return errors.Errorf("setTeeAddress: %s", err)
	}
	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return errors.Errorf("failed waiting for setTeeAddress: %s", err)
	}
	if receipt.Status != 1 {
		return errors.Errorf("setTeeAddress failed with status %d", receipt.Status)
	}
	return nil
}

// SetGateway registers the address allowed to call getWeather/requestSettlement
// (onlyGateway). Owner only.
func SetGateway(s *support.Support, contractAddr, gatewayAddr common.Address) error {
	c, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		return errors.Errorf("failed to bind contract: %s", err)
	}
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return errors.Errorf("failed to create transactor: %s", err)
	}
	tx, err := c.SetGateway(opts, gatewayAddr)
	if err != nil {
		return errors.Errorf("setGateway: %s (%s)", err, simulateRevert(s, contractAddr, nil, "setGateway", gatewayAddr))
	}
	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return errors.Errorf("failed waiting for setGateway: %s", err)
	}
	if receipt.Status != 1 {
		return errors.Errorf("setGateway failed with status %d", receipt.Status)
	}
	return nil
}

// SendRequestSettlement sends a requestSettlement instruction for a policy and
// returns the resulting TEE instruction ID (to poll the proxy for the result).
// s.Prv must be the contract's registered gateway address (setGateway) —
// requestSettlement is onlyGateway. payer is who the on-chain settleFee (if
// any) is charged to; payer must have approved this contract for at least
// settleFee of feeToken beforehand.
func SendRequestSettlement(s *support.Support, contractAddr, payer common.Address, policyId *big.Int) (common.Hash, common.Hash, error) {
	c, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to bind contract: %s", err)
	}
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to create transactor: %s", err)
	}
	opts.Value = DefaultFee

	tx, err := c.RequestSettlement(opts, policyId, payer)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("requestSettlement: %s (%s)", err, simulateRevert(s, contractAddr, DefaultFee, "requestSettlement", policyId, payer))
	}
	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed waiting for requestSettlement: %s", err)
	}
	if receipt.Status != 1 {
		return common.Hash{}, common.Hash{}, errors.Errorf("requestSettlement failed with status %d", receipt.Status)
	}
	if len(receipt.Logs) == 0 {
		return common.Hash{}, common.Hash{}, errors.New("no logs found in receipt")
	}
	instructionId, err := parseInstructionSent(s, receipt)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to parse TeeInstructionsSent event: %s", err)
	}
	return instructionId, receipt.TxHash, nil
}

// Settle relays a TEE-signed settlement to the contract, which verifies the
// signature and pays out if the rainfall threshold was met.
func Settle(s *support.Support, contractAddr common.Address, resultData []byte, actionID common.Hash, submissionTag string, status uint8, signature []byte) (common.Hash, error) {
	c, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		return common.Hash{}, errors.Errorf("failed to bind contract: %s", err)
	}
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Hash{}, errors.Errorf("failed to create transactor: %s", err)
	}

	tx, err := c.Settle(opts, resultData, actionID, submissionTag, status, signature)
	if err != nil {
		return common.Hash{}, errors.Errorf("settle: %s (%s)", err, simulateRevert(s, contractAddr, nil, "settle", resultData, actionID, submissionTag, status, signature))
	}
	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return common.Hash{}, errors.Errorf("failed waiting for settle: %s", err)
	}
	if receipt.Status != 1 {
		return common.Hash{}, errors.Errorf("settle failed with status %d", receipt.Status)
	}
	return receipt.TxHash, nil
}

// RequestAndRelaySettlement runs the keeper flow for one policy: it sends a
// requestSettlement instruction, polls the proxy for the TEE-signed result, and
// relays it to settle(). Returns the settle tx hash and the proxy ActionResponse.
// s.Prv must be the contract's registered gateway address (setGateway). payer is
// who the on-chain settleFee (if any) is charged to — pass the gateway's own
// address for fee-free automated keeper runs (settleFee disabled), or the
// policyholder's address if they've approved settleFee beforehand.
func RequestAndRelaySettlement(s *support.Support, contractAddr, payer common.Address, proxyURL string, policyId *big.Int) (common.Hash, *teetypes.ActionResponse, error) {
	logger.Infof(
		"[settlement] start policyId=%s contract=%s proxyURL=%s",
		policyId.String(),
		contractAddr.Hex(),
		proxyURL,
	)
	logger.Infof("[settlement] step 1/3: sending requestSettlement")

	instructionID, requestTx, err := SendRequestSettlement(s, contractAddr, payer, policyId)
	if err != nil {
		logger.Errorf("[settlement] step 1/3 failed: %s", err)
		return common.Hash{}, nil, errors.Errorf("requestSettlement: %s", err)
	}
	logger.Infof(
		"[settlement] step 1/3 done instructionId=%s requestTx=%s",
		instructionID.Hex(),
		requestTx.Hex(),
	)

	actionResultURL := strings.TrimRight(proxyURL, "/") + "/action/result/" + instructionID.Hex()
	logger.Infof("[settlement] step 2/3: polling action result at %s", actionResultURL)

	resp, err := fccutils.ActionResult(proxyURL, instructionID)
	if err != nil {
		logger.Errorf("[settlement] step 2/3 failed: %s", err)
		return common.Hash{}, nil, errors.Errorf("poll settlement result: %s", err)
	}
	logger.Infof(
		"[settlement] step 2/3 done status=%d actionId=%s submissionTag=%s resultBytes=%d signatureBytes=%d",
		resp.Result.Status,
		resp.Result.ID.Hex(),
		string(resp.Result.SubmissionTag),
		len(resp.Result.Data),
		len(resp.Signature),
	)
	if resp.Result.Status != 1 {
		logger.Errorf("[settlement] tee settlement returned failure status=%d log=%s", resp.Result.Status, resp.Result.Log)
		return common.Hash{}, resp, errors.Errorf("TEE settlement failed: %s", resp.Result.Log)
	}

	logger.Infof("[settlement] step 3/3: relaying settle on-chain")
	settleTx, err := Settle(
		s,
		contractAddr,
		resp.Result.Data,
		resp.Result.ID,
		string(resp.Result.SubmissionTag),
		resp.Result.Status,
		resp.Signature,
	)
	if err != nil {
		logger.Errorf("[settlement] step 3/3 failed: %s", err)
		return common.Hash{}, resp, errors.Errorf("relay settle: %s", err)
	}
	logger.Infof("[settlement] complete policyId=%s settleTx=%s", policyId.String(), settleTx.Hex())
	return settleTx, resp, nil
}

// parseInstructionSent scans a receipt for the TeeInstructionsSent log. Can't
// assume it's Logs[0]: getWeather/requestSettlement emit ERC-20
// Transfer/FeeCollected logs before it when a feeToken fee is configured.
func parseInstructionSent(s *support.Support, receipt *types.Receipt) (common.Hash, error) {
	for _, log := range receipt.Logs {
		if log == nil {
			continue
		}
		instructionSent, err := s.TeeVerification.ParseTeeInstructionsSent(*log)
		if err == nil {
			return instructionSent.InstructionId, nil
		}
	}
	return common.Hash{}, errors.New("no TeeInstructionsSent log found in receipt")
}

// simulateRevert best-effort decodes a revert reason for a failed call.
func simulateRevert(s *support.Support, contractAddr common.Address, value *big.Int, method string, args ...interface{}) string {
	parsed, err := weather.WeatherInsuranceMetaData.GetAbi()
	if err != nil || parsed == nil {
		return ""
	}
	callData, err := parsed.Pack(method, args...)
	if err != nil {
		return ""
	}
	from := crypto.PubkeyToAddress(s.Prv.PublicKey)
	return fccutils.SimulateAndDecodeRevert(s.ChainClient, from, contractAddr, value, callData)
}
