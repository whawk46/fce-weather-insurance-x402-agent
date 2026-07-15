package x402

import (
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func TestFetchHandlerRejectsMissingCity(t *testing.T) {
	h := &Handler{}
	body := `{"payer":"0x0000000000000000000000000000000000000001"}`
	req := httptest.NewRequest(http.MethodPost, "/x402/weather/fetch", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.FetchHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestFetchHandlerRejectsMissingPayer(t *testing.T) {
	h := &Handler{}
	body := `{"city":"Berlin,DE"}`
	req := httptest.NewRequest(http.MethodPost, "/x402/weather/fetch", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.FetchHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestSettleHandlerRejectsNonIntegerPolicyId(t *testing.T) {
	h := &Handler{}
	body := `{"policyId":"not-a-number","payer":"0x0000000000000000000000000000000000000001"}`
	req := httptest.NewRequest(http.MethodPost, "/x402/weather/settle", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.SettleHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestSettleHandlerRejectsMissingPayer(t *testing.T) {
	h := &Handler{}
	body := `{"policyId":"3"}`
	req := httptest.NewRequest(http.MethodPost, "/x402/weather/settle", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.SettleHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestRequirePaymentSkipsWhenFeeIsZero(t *testing.T) {
	h := &Handler{}
	rec := httptest.NewRecorder()
	payer := common.HexToAddress("0x1")

	ok := h.requirePayment(rec, "/x402/weather/fetch", payer, big.NewInt(0))
	if !ok {
		t.Fatalf("expected requirePayment to pass through when fee is 0")
	}
	if rec.Code != 200 {
		// no response should have been written at all
		t.Fatalf("expected no response body to be written, got status %d", rec.Code)
	}
}

func TestPaymentRequirementsJSONShape(t *testing.T) {
	// Documents the 402 body contract the frontend/tests rely on.
	pr := paymentRequirements{
		X402Version:          1,
		Resource:             "/x402/weather/fetch",
		ChainID:              114,
		Asset:                "0x0b6A3645c240605887a5532109323A3E12273dc7",
		Spender:              "0xF501F9c8394b868613b5Db3D284C6368F687c1B8",
		AmountBase:           "10000",
		CurrentAllowanceBase: "0",
	}
	b, err := json.Marshal(pr)
	if err != nil {
		t.Fatalf("marshal: %s", err)
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %s", err)
	}
	for _, key := range []string{"x402Version", "resource", "chainId", "asset", "spender", "amountBase", "currentAllowanceBase"} {
		if _, ok := out[key]; !ok {
			t.Errorf("missing key %q in 402 body", key)
		}
	}
}
