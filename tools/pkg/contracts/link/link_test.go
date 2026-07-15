package link

import (
	"path/filepath"
	"runtime"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func TestLinkBytecodeFromArtifact(t *testing.T) {
	root := projectRoot(t)
	artifact := filepath.Join(root, "out", "InstructionSender.sol", "WeatherInsurance.json")
	lib := common.HexToAddress("0xb6062A32993055fb012A229f1b59b61100Cfc75c")

	linked, err := LinkBytecodeFromArtifact(artifact, map[string]common.Address{
		"contracts/SettlementTime.sol:SettlementTime": lib,
	})
	if err != nil {
		t.Fatalf("LinkBytecodeFromArtifact: %v", err)
	}
	if len(linked) < 20_000 {
		t.Fatalf("linked bytecode too short: %d", len(linked))
	}
}

func projectRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", ".."))
}
