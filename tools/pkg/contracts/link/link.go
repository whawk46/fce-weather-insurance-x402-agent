package link

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/ethereum/go-ethereum/common"
)

// Solidity library placeholders in forge bytecode.object (not valid hex).
var libraryPlaceholder = regexp.MustCompile(`__\$[0-9a-f]+\$\__`)

type linkRef struct {
	Start  int `json:"start"`
	Length int `json:"length"`
}

type forgeArtifact struct {
	Bytecode struct {
		Object         string                            `json:"object"`
		LinkReferences map[string]map[string][]linkRef `json:"linkReferences"`
	} `json:"bytecode"`
}

// decodeUnlinkedObject parses forge bytecode.object (hex + __$...$__ placeholders).
func decodeUnlinkedObject(object string) ([]byte, error) {
	object = strings.TrimPrefix(object, "0x")
	var out []byte
	last := 0
	for _, loc := range libraryPlaceholder.FindAllStringIndex(object, -1) {
		if loc[0] > last {
			chunk, err := hex.DecodeString(object[last:loc[0]])
			if err != nil {
				return nil, fmt.Errorf("decode hex before library placeholder: %w", err)
			}
			out = append(out, chunk...)
		}
		out = append(out, make([]byte, 20)...)
		last = loc[1]
	}
	if last < len(object) {
		chunk, err := hex.DecodeString(object[last:])
		if err != nil {
			return nil, fmt.Errorf("decode hex after library placeholder: %w", err)
		}
		out = append(out, chunk...)
	}
	return out, nil
}

// LinkBytecodeFromArtifact reads forge JSON, decodes unlinked creation bytecode, and links libraries.
func LinkBytecodeFromArtifact(artifactPath string, libs map[string]common.Address) ([]byte, error) {
	raw, err := os.ReadFile(artifactPath)
	if err != nil {
		return nil, fmt.Errorf("read artifact %s: %w", artifactPath, err)
	}
	var art forgeArtifact
	if err := json.Unmarshal(raw, &art); err != nil {
		return nil, fmt.Errorf("parse artifact: %w", err)
	}
	out, err := decodeUnlinkedObject(art.Bytecode.Object)
	if err != nil {
		return nil, err
	}

	for file, names := range art.Bytecode.LinkReferences {
		for libName, refs := range names {
			key := file + ":" + libName
			addr, ok := libs[key]
			if !ok {
				return nil, fmt.Errorf("missing library address for %s", key)
			}
			for _, ref := range refs {
				if ref.Length != 20 {
					return nil, fmt.Errorf("unexpected link length %d for %s", ref.Length, key)
				}
				end := ref.Start + ref.Length
				if end > len(out) {
					return nil, fmt.Errorf("link offset out of range for %s (size %d, need %d)", key, len(out), end)
				}
				copy(out[ref.Start:end], addr.Bytes())
			}
		}
	}
	return out, nil
}
