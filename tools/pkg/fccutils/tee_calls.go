package fccutils

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/flare-foundation/go-flare-common/pkg/logger"
	csigning "github.com/flare-foundation/go-flare-common/pkg/signing"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/tee/attestation/googlecloud"
	"github.com/flare-foundation/tee-node/pkg/attestation"
	"github.com/flare-foundation/tee-node/pkg/types"
	"github.com/pkg/errors"
)

const repeats = 20

func TeeInfo(nodeURL string) (*types.SignedTeeInfoResponse, error) {
	result, err := http.Get(nodeURL + "/info")
	if err != nil {
		return nil, errors.Errorf("%s", err)
	}
	defer result.Body.Close()

	var teeInfo types.SignedTeeInfoResponse
	err = json.NewDecoder(result.Body).Decode(&teeInfo)
	if err != nil {
		return nil, errors.Errorf("%s", err)
	}

	return &teeInfo, nil
}

func CodeHashAndPlatform(attestationString string) (common.Hash, common.Hash, error) {
	claims := attestation.NeededClaims{}
	_, _, err := googlecloud.ParsePKITokenUnverifiedClaims(attestationString, &claims)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("%s", err)
	}

	codeHash, err := claims.CodeHash()
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("%s", err)
	}
	platform, err := claims.Platform()
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("%s", err)
	}

	return codeHash, platform, nil
}

func TeeProxyId(teeInfo *types.SignedTeeInfoResponse) (common.Address, common.Address, error) {
	pubKey, err := types.ParsePubKey(teeInfo.TeeInfo.PublicKey)
	if err != nil {
		return common.Address{}, common.Address{}, errors.Errorf("%s", err)
	}

	teeID := crypto.PubkeyToAddress(*pubKey)

	hash, err := teeInfo.TeeInfo.Hash()
	if err != nil {
		return common.Address{}, common.Address{}, errors.Errorf("%s", err)
	}
	// The proxy signs the TEE info over a domain-separated, chain-ID-bound
	// payload (Payload{ProxyTeeInfo, chainID, infoHash}) — see tee-proxy
	// external.go. Recover the proxy address over the SAME preimage, or the
	// proxyId comes out garbage and the on-chain availability check is rejected
	// by the verifier with "proxy signer does not match".
	infoSignHash, err := csigning.NewPayload(csigning.ProxyTeeInfo, teeInfo.TeeInfo.ChainID, common.BytesToHash(hash)).Hash()
	if err != nil {
		return common.Address{}, common.Address{}, errors.Errorf("%s", err)
	}
	proxyPubKey, err := crypto.SigToPub(accounts.TextHash(infoSignHash[:]), teeInfo.ProxySignature)
	if err != nil {
		return common.Address{}, common.Address{}, errors.Errorf("%s", err)
	}
	proxyID := crypto.PubkeyToAddress(*proxyPubKey)

	return teeID, proxyID, nil
}

func ActionResult(nodeURL string, actionID common.Hash) (*types.ActionResponse, error) {
	actionResultURL := nodeURL + "/action/result/" + actionID.Hex()
	logger.Infof("[action-result] start actionId=%s url=%s maxAttempts=%d", actionID.Hex(), actionResultURL, repeats)

	var lastLog string
	for attempt := range repeats {
		attemptNum := attempt + 1
		result, err := http.Get(actionResultURL)
		if err != nil {
			logger.Warnf("[action-result] attempt=%d/%d actionId=%s requestErr=%s", attemptNum, repeats, actionID.Hex(), err)
			time.Sleep(2 * time.Second)
			continue
		}

		if result.StatusCode != http.StatusOK {
			logger.Warnf("[action-result] attempt=%d/%d actionId=%s httpStatus=%d url=%s", attemptNum, repeats, actionID.Hex(), result.StatusCode, actionResultURL)
			result.Body.Close()
			time.Sleep(2 * time.Second)
			continue
		}

		var response types.ActionResponse
		decodeErr := json.NewDecoder(result.Body).Decode(&response)
		result.Body.Close()
		if decodeErr != nil {
			logger.Warnf("[action-result] attempt=%d/%d actionId=%s decodeErr=%s", attemptNum, repeats, actionID.Hex(), decodeErr)
			time.Sleep(2 * time.Second)
			continue
		}

		lastLog = response.Result.Log
		// Status 1 = finished. Status 2 = extension still processing (async OpenWeatherMap).
		if response.Result.Status == 1 {
			logger.Infof(
				"[action-result] success actionId=%s attempt=%d status=%d resultId=%s submissionTag=%s resultBytes=%d signatureBytes=%d",
				actionID.Hex(),
				attemptNum,
				response.Result.Status,
				response.Result.ID.Hex(),
				string(response.Result.SubmissionTag),
				len(response.Result.Data),
				len(response.Signature),
			)
			return &response, nil
		}

		logger.Warnf(
			"[action-result] attempt=%d/%d actionId=%s teeStatus=%d log=%q",
			attemptNum,
			repeats,
			actionID.Hex(),
			response.Result.Status,
			lastLog,
		)
		time.Sleep(2 * time.Second)
	}

	if lastLog != "" {
		return nil, errors.Errorf("action result not ready after %d attempts: %s", repeats, lastLog)
	}
	return nil, errors.Errorf("action result not ready after %d attempts", repeats)
}

func SetProxyUrl(configurationPort int, proxyPort int) error {
	url := fmt.Sprintf("http://localhost:%d", proxyPort)
	request := types.ConfigureProxyURLRequest{
		URL: &url,
	}

	body, err := json.Marshal(request)
	if err != nil {
		return err
	}

	url = fmt.Sprintf("http://localhost:%d/proxy", configurationPort)
	logger.Infof("Setting proxy url on tee: %s", url)
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}

func SetInitialOwner(configurationPort int, ownerAddress common.Address) error {
	request := types.ConfigureInitialOwnerRequest{
		Owner: &ownerAddress,
	}

	body, err := json.Marshal(request)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("http://localhost:%d/initial-owner", configurationPort)
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}

func SetExtensionID(configurationPort int, extensionID common.Hash) error {
	request := types.ConfigureExtensionIDRequest{
		ExtensionID: &extensionID,
	}

	body, err := json.Marshal(request)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("http://localhost:%d/extension-id", configurationPort)
	logger.Infof("Setting extension id on tee: %s", url)
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}
