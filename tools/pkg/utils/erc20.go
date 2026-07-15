package utils

import (
	"context"
	"math/big"
	"strings"

	"weather-insurance/tools/pkg/support"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/pkg/errors"
)

const erc20ABI = `[
  {"name":"approve","type":"function","stateMutability":"nonpayable","inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"name":"","type":"bool"}]},
  {"name":"allowance","type":"function","stateMutability":"view","inputs":[{"name":"owner","type":"address"},{"name":"spender","type":"address"}],"outputs":[{"name":"","type":"uint256"}]},
  {"name":"balanceOf","type":"function","stateMutability":"view","inputs":[{"name":"account","type":"address"}],"outputs":[{"name":"","type":"uint256"}]},
  {"name":"decimals","type":"function","stateMutability":"view","inputs":[],"outputs":[{"name":"","type":"uint8"}]},
  {"name":"symbol","type":"function","stateMutability":"view","inputs":[],"outputs":[{"name":"","type":"string"}]}
]`

func erc20(token common.Address, s *support.Support) (*bind.BoundContract, error) {
	parsed, err := abi.JSON(strings.NewReader(erc20ABI))
	if err != nil {
		return nil, err
	}
	return bind.NewBoundContract(token, parsed, s.ChainClient, s.ChainClient, s.ChainClient), nil
}

// Approve sets `spender`'s allowance on `token` to `amount` from the support key.
func Approve(s *support.Support, token, spender common.Address, amount *big.Int) error {
	c, err := erc20(token, s)
	if err != nil {
		return errors.Errorf("erc20 bind: %s", err)
	}
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return errors.Errorf("transactor: %s", err)
	}
	tx, err := c.Transact(opts, "approve", spender, amount)
	if err != nil {
		return errors.Errorf("approve: %s", err)
	}
	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return errors.Errorf("wait approve: %s", err)
	}
	if receipt.Status != 1 {
		return errors.Errorf("approve failed with status %d", receipt.Status)
	}
	return nil
}

// Allowance returns how much `spender` may pull from `owner` on `token`.
func Allowance(s *support.Support, token, owner, spender common.Address) (*big.Int, error) {
	c, err := erc20(token, s)
	if err != nil {
		return nil, errors.Errorf("erc20 bind: %s", err)
	}
	var out []interface{}
	if err := c.Call(&bind.CallOpts{}, &out, "allowance", owner, spender); err != nil {
		return nil, errors.Errorf("allowance: %s", err)
	}
	if len(out) != 1 {
		return nil, errors.New("allowance: unexpected output")
	}
	return out[0].(*big.Int), nil
}

// TokenBalance returns `account`'s balance of `token`.
func TokenBalance(s *support.Support, token, account common.Address) (*big.Int, error) {
	c, err := erc20(token, s)
	if err != nil {
		return nil, errors.Errorf("erc20 bind: %s", err)
	}
	var out []interface{}
	if err := c.Call(&bind.CallOpts{}, &out, "balanceOf", account); err != nil {
		return nil, errors.Errorf("balanceOf: %s", err)
	}
	if len(out) != 1 {
		return nil, errors.New("balanceOf: unexpected output")
	}
	return out[0].(*big.Int), nil
}
