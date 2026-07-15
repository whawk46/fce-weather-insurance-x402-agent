// Package main runs the weather-insurance end-to-end demo (the DappCon flow):
//  1. setExtensionId on the deployed WeatherInsurance contract (idempotent)
//  2. set the ERC-20 pay token + fund the payout pool
//  3. register the TEE signing address (read from the proxy)
//  4. buy a rainfall policy for a date (premium paid in the pay token)
//  5. keeper: request settlement → poll the TEE → relay the signed result
//  6. assert the policy settled and paid the token payout iff rainfall >= threshold
package main

import (
	"flag"
	"math/big"
	"os"
	"strings"

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
	contractF := flag.String("instructionSender", os.Getenv("INSTRUCTION_SENDER"), "WeatherInsurance contract address")
	tokenF := flag.String("payToken", envOr("PAY_TOKEN", "0x53192e788991AD96bC180249B15AefB94E597dD1"), "ERC-20 used for premiums and payouts")
	dateF := flag.String("date", "2026-05-26", "coverage date YYYY-MM-DD (must have day_summary data)")
	cityF := flag.String("city", "Berlin,DE", "coverage location as City,CC (geocoded via OpenWeatherMap)")
	thresholdF := flag.Int64("thresholdMmE2", 1, "rainfall trigger threshold in mm×100 (1 = 0.01mm)")
	privateF := flag.Bool("private", true, "use ECIES-encrypted buyPolicyPrivate + relayPrivateBuy (default); pass -private=false for public buyPolicy")
	flag.Parse()

	if *contractF == "" {
		logger.Fatal("--instructionSender flag is required (or set INSTRUCTION_SENDER in .env)")
	}
	contractAddr := common.HexToAddress(*contractF)
	token := common.HexToAddress(*tokenF)

	s, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	holder := crypto.PubkeyToAddress(s.Prv.PublicKey)

	// Whole-token amounts (WPT has 18 decimals) so the payout is obvious next to gas.
	oneToken := big.NewInt(1_000_000_000_000_000_000)    // 1e18
	payout := new(big.Int).Mul(big.NewInt(10), oneToken) // 10 WPT — the policy value
	premium := new(big.Int).Set(oneToken)                // 1 WPT

	// --- Step 1: setExtensionId ---
	logger.Infof("Step 1: Setting extension ID...")
	if err := instrutils.SetExtensionId(s, contractAddr); err != nil {
		if strings.Contains(err.Error(), "already set") {
			logger.Infof("  Extension ID already set, continuing")
		} else {
			fccutils.FatalWithCause(errors.Errorf("setExtensionId failed — is the extension registered (pre-build)? %s", err))
		}
	} else {
		logger.Infof("  Extension ID set.")
	}

	// --- Step 2: set pay token + fund the payout pool ---
	logger.Infof("Step 2: Setting pay token %s and funding pool with %s...", token.Hex(), tok(payout))
	if err := instrutils.SetPayToken(s, contractAddr, token); err != nil {
		fccutils.FatalWithCause(errors.Errorf("setPayToken: %s", err))
	}
	if err := instrutils.FundPool(s, contractAddr, token, payout); err != nil {
		fccutils.FatalWithCause(errors.Errorf("fundPool: %s", err))
	}

	// getWeather/requestSettlement are onlyGateway; this demo wallet plays both
	// roles (owner + gateway + holder), so register itself before using either.
	logger.Infof("Registering self as gateway...")
	if err := instrutils.SetGateway(s, contractAddr, holder); err != nil {
		fccutils.FatalWithCause(errors.Errorf("setGateway: %s", err))
	}

	// --- Step 3: register the TEE signing address ---
	logger.Infof("Step 3: Registering TEE signing address...")
	info, err := fccutils.TeeInfo(*pf)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("fetch TEE info: %s", err))
	}
	teeAddr, _, err := fccutils.TeeProxyId(info)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("derive TEE address: %s", err))
	}
	logger.Infof("  TEE address: %s", teeAddr.Hex())
	if err := instrutils.SetTeeAddress(s, contractAddr, teeAddr); err != nil {
		fccutils.FatalWithCause(errors.Errorf("setTeeAddress: %s", err))
	}

	// --- Step 4: buy a policy ---
	lat, lon, err := instrutils.GeocodeCity(*cityF)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("geocode %q: %s", *cityF, err))
	}
	logger.Infof("  Location %s → lat=%s lon=%s", *cityF, lat, lon)

	var policyId *big.Int
	if *privateF {
		logger.Infof("Step 4: Private buy for %s @ %s (threshold %d mm×100, payout %s, premium %s)...",
			*dateF, *cityF, *thresholdF, tok(payout), tok(premium))
		var relayTx common.Hash
		policyId, relayTx, _, err = instrutils.RequestAndRelayPrivateBuy(
			s, contractAddr, *pf, holder, *dateF, big.NewInt(*thresholdF), payout, premium, lat, lon,
		)
		if err != nil {
			fccutils.FatalWithCause(errors.Errorf("private buy: %s", err))
		}
		logger.Infof("  Bought policy #%s (relay tx %s)", policyId, relayTx.Hex())
	} else {
		logger.Infof("Step 4: Buying policy for %s (threshold %d mm×100, payout %s, premium %s)...",
			*dateF, *thresholdF, tok(payout), tok(premium))
		policyId, err = instrutils.BuyPolicy(s, contractAddr, token, *dateF, big.NewInt(*thresholdF), payout, premium, lat, lon)
		if err != nil {
			fccutils.FatalWithCause(errors.Errorf("buyPolicy: %s", err))
		}
		logger.Infof("  Bought policy #%s", policyId)
	}

	// Holder token balance right before settlement, to measure the payout transfer.
	balBefore, err := instrutils.TokenBalance(s, token, holder)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("balanceOf before: %s", err))
	}

	// If an on-chain settleFee is configured, requestSettlement pulls it from
	// `holder` via transferFrom — approve it first (settleFee 0 means no fee).
	c, err := weather.NewWeatherInsurance(contractAddr, s.ChainClient)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("bind contract: %s", err))
	}
	settleFee, err := c.SettleFee(&bind.CallOpts{})
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("read settleFee: %s", err))
	}
	if settleFee.Sign() > 0 {
		feeToken, err := c.FeeToken(&bind.CallOpts{})
		if err != nil {
			fccutils.FatalWithCause(errors.Errorf("read feeToken: %s", err))
		}
		logger.Infof("Approving settleFee %s of feeToken %s...", settleFee.String(), feeToken.Hex())
		if err := instrutils.Approve(s, feeToken, contractAddr, settleFee); err != nil {
			fccutils.FatalWithCause(errors.Errorf("approve settleFee: %s", err))
		}
	}

	// --- Step 5: keeper settles (request → poll TEE → relay signed result) ---
	logger.Infof("Step 5: Settling policy #%s (keeper)...", policyId)
	settleTx, resp, err := instrutils.RequestAndRelaySettlement(s, contractAddr, holder, *pf, policyId)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("settlement: %s", err))
	}
	logger.Infof("  TEE result data: %s", resp.Result.Data.String())
	logger.Infof("  settle tx: %s", settleTx.Hex())

	// --- Step 6: verify outcome ---
	logger.Infof("Step 6: Reading settled policy...")
	p, err := c.Policies(&bind.CallOpts{}, policyId)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("read policy: %s", err))
	}

	logger.Infof("  private=%v date=%q measured=%s mm×100 threshold=%s settled=%v paidOut=%v",
		p.IsPrivate, p.Date, p.MeasuredMmE2, p.RainThresholdMmE2, p.Settled, p.PaidOut)

	if !p.Settled {
		fccutils.FatalWithCause(errors.New("FAIL: policy not settled"))
	}
	if *privateF {
		if p.IsPrivate {
			fccutils.FatalWithCause(errors.New("FAIL: private policy should be public after settlement"))
		}
		if p.RainThresholdMmE2.Sign() <= 0 {
			fccutils.FatalWithCause(errors.New("FAIL: rain threshold not revealed on-chain"))
		}
	}
	expectPaid := p.MeasuredMmE2.Cmp(p.RainThresholdMmE2) >= 0
	if p.PaidOut != expectPaid {
		fccutils.FatalWithCause(errors.Errorf("FAIL: paidOut=%v but measured(%s) >= threshold(%s) is %v",
			p.PaidOut, p.MeasuredMmE2, p.RainThresholdMmE2, expectPaid))
	}

	// Confirm the token payout actually moved.
	balAfter, err := instrutils.TokenBalance(s, token, holder)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("balanceOf after: %s", err))
	}
	delta := new(big.Int).Sub(balAfter, balBefore)

	if p.PaidOut {
		if delta.Cmp(p.Payout) != 0 {
			fccutils.FatalWithCause(errors.Errorf("FAIL: expected payout %s, holder balance changed by %s", tok(p.Payout), tok(delta)))
		}
		logger.Infof("  ✓ Rainfall %.2f mm met threshold %.2f mm — paid out %s (holder balance +%s).",
			float64(p.MeasuredMmE2.Int64())/100, float64(p.RainThresholdMmE2.Int64())/100, tok(p.Payout), tok(delta))
	} else {
		logger.Infof("  ✓ Rainfall %.2f mm below threshold %.2f mm — no payout (premium retained).",
			float64(p.MeasuredMmE2.Int64())/100, float64(p.RainThresholdMmE2.Int64())/100)
	}

	logger.Infof("All tests passed.")
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// tok formats an 18-decimal token amount as a human-readable WPT string.
func tok(amount *big.Int) string {
	f := new(big.Float).Quo(new(big.Float).SetInt(amount), big.NewFloat(1e18))
	return f.Text('f', 4) + " WPT"
}
