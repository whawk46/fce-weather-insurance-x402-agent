// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { SettlementTime } from "../contracts/SettlementTime.sol";

contract SettlementTimeHarness {
    function unlock(string memory dateYmd) external pure returns (uint64) {
        return SettlementTime.unlockAt(dateYmd);
    }
}

contract SettlementTimeTest is Test {
    SettlementTimeHarness internal h;

    function setUp() public {
        h = new SettlementTimeHarness();
    }

    function test_unlockAt_matchesGoVectors() public view {
        assertEq(h.unlock("2026-06-04"), 1780617600);
        assertEq(h.unlock("2026-01-15"), 1768521600);
    }

    function test_unlockAt_revertsBadFormat() public {
        vm.expectRevert("bad date length");
        h.unlock("2026-6-04");
    }
}
