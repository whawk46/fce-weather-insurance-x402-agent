// Package main is the settlement keeper: for a given policy it asks the TEE to
// fetch the coverage date's rainfall, then relays the TEE-signed result to the
// WeatherInsurance contract, which verifies the signature and pays out if the
// policy threshold was met.
//
// Run after settlementUnlockAt (midnight UTC on the day after the coverage date).
//
//	go run ./cmd/settle -contract 0x... -policyId 0
package main

import (
	"flag"
	"math/big"
	"os"

	"weather-insurance/tools/pkg/configs"
	"weather-insurance/tools/pkg/contracts/weather"
	"weather-insurance/tools/pkg/fccutils"
	"weather-insurance/tools/pkg/support"
	instrutils "weather-insurance/tools/pkg/utils"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/pkg/errors"
)

func main() {
	af := flag.String("a", configs.AddressesFile, "file with deployed addresses")
	cf := flag.String("c", configs.ChainNodeURL, "chain node url")
	pf := flag.String("p", configs.ExtensionProxyURL, "extension proxy url")
	contractF := flag.String("contract", os.Getenv("INSTRUCTION_SENDER"), "WeatherInsurance contract address")
	policyF := flag.Int64("policyId", -1, "policy id to settle")
	payerF := flag.String("payer", "", "address settleFee (if any) is charged to; defaults to this keeper's own address")
	flag.Parse()

	if *contractF == "" {
		logger.Fatal("--contract is required (or set INSTRUCTION_SENDER in .env)")
	}
	if *policyF < 0 {
		logger.Fatal("--policyId is required")
	}

	contractAddr := common.HexToAddress(*contractF)
	policyId := big.NewInt(*policyF)

	s, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	// requestSettlement is onlyGateway — this keeper's key must be the contract's
	// registered gateway (setGateway during extension-setup.sh).
	self := crypto.PubkeyToAddress(s.Prv.PublicKey)
	payer := self
	if *payerF != "" {
		payer = common.HexToAddress(*payerF)
	}

	// If a settleFee is configured and this keeper is paying for itself,
	// approve it here. If --payer names a third party, they must have
	// approved the fee themselves — the keeper can't approve on their behalf.
	c, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("bind contract: %s", err))
	}
	settleFee, err := c.SettleFee(&bind.CallOpts{})
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("read settleFee: %s", err))
	}
	if settleFee.Sign() > 0 && payer == self {
		feeToken, err := c.FeeToken(&bind.CallOpts{})
		if err != nil {
			fccutils.FatalWithCause(errors.Errorf("read feeToken: %s", err))
		}
		logger.Infof("Approving settleFee %s of feeToken %s...", settleFee.String(), feeToken.Hex())
		if err := instrutils.Approve(s, feeToken, contractAddr, settleFee); err != nil {
			fccutils.FatalWithCause(errors.Errorf("approve settleFee: %s", err))
		}
	}

	logger.Infof("Settling policy %s on %s (payer %s)...", policyId, contractAddr.Hex(), payer.Hex())
	settleTx, resp, err := instrutils.RequestAndRelaySettlement(s, contractAddr, payer, *pf, policyId)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("settlement failed: %s", err))
	}

	logger.Infof("  TEE result data: %s", resp.Result.Data.String())
	logger.Infof("  Settle tx: %s", settleTx.Hex())
	logger.Infof("Done.")
}
