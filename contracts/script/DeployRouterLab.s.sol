// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {R3OSPaint} from "../src/R3OSPaint.sol";
import {R3OSRouterLab} from "../src/router/R3OSRouterLab.sol";
import {
    MockWrappedNative,
    MockUSD,
    ViewVenue,
    StatefulVenue,
    RevertBubbleVenue,
    UnavailableVenue,
    MalformedVenue,
    GasBurnerVenue,
    UnderDeliveringVenue,
    OpaqueSwapDataVenue
} from "../test/RouterMocks.sol";
import {MockVenueDirectory} from "../test/MockVenueDirectory.sol";

/// @notice Add-on deployment for the read-only MRC-17 routing lab.
contract DeployRouterLab is Script {
    function run() external {
        R3OSPaint paint = R3OSPaint(vm.envAddress("PAINT_ADDRESS"));
        bool deployMocks = block.chainid != 143 && vm.envOr("DEPLOY_MOCK_VENUES", true);

        vm.startBroadcast();
        R3OSRouterLab lab = new R3OSRouterLab();
        MockVenueDirectory directory;
        if (deployMocks) directory = _deployMocks();
        (, address broadcaster,) = vm.readCallers();

        uint256 labId = paint.experimentCount();
        uint256 directoryId = labId + 1;
        bytes memory labCall = abi.encodeCall(R3OSPaint.addExperiment, (address(lab), "router-lab", ""));
        bytes memory directoryCall;
        if (address(directory) != address(0)) {
            directoryCall = abi.encodeCall(
                R3OSPaint.addExperiment,
                (address(directory), "router-mock-venues", "")
            );
        }

        if (paint.owner() == broadcaster) {
            labId = paint.addExperiment(address(lab), "router-lab", "");
            if (address(directory) != address(0)) {
                directoryId = paint.addExperiment(address(directory), "router-mock-venues", "");
            }
        } else {
            console.log("SAFE calldata: Paint.addExperiment(router-lab)");
            console.logBytes(labCall);
            if (directoryCall.length != 0) {
                console.log("SAFE calldata: Paint.addExperiment(router-mock-venues)");
                console.logBytes(directoryCall);
            }
        }
        vm.stopBroadcast();

        console.log("R3OSRouterLab", address(lab));
        console.log("router-lab experiment id", labId);
        if (address(directory) != address(0)) {
            console.log("MockVenueDirectory", address(directory));
            console.log("router-mock-venues experiment id", directoryId);
        }
    }

    function _deployMocks() private returns (MockVenueDirectory directory) {
        MockWrappedNative wrapped = new MockWrappedNative();
        MockUSD usd = new MockUSD();
        address[] memory adapters = new address[](8);
        string[] memory labels = new string[](8);

        adapters[0] = address(new ViewVenue(32_000));
        labels[0] = "view";
        adapters[1] = address(new StatefulVenue(32_500));
        labels[1] = "stateful";
        adapters[2] = address(new RevertBubbleVenue(32_300));
        labels[2] = "revert-bubble";
        adapters[3] = address(new UnavailableVenue());
        labels[3] = "unavailable";
        adapters[4] = address(new MalformedVenue());
        labels[4] = "malformed";
        adapters[5] = address(new GasBurnerVenue());
        labels[5] = "gas-burner";
        adapters[6] = address(new UnderDeliveringVenue(32_400, 9_900));
        labels[6] = "under-delivering";
        adapters[7] = address(new OpaqueSwapDataVenue(32_200));
        labels[7] = "opaque-data";

        for (uint256 i; i < adapters.length; ++i) usd.mint(adapters[i], 1_000_000_000_000);
        directory = new MockVenueDirectory(adapters, labels, address(wrapped), address(usd));
        console.log("MockWrappedNative", address(wrapped));
        console.log("MockUSD", address(usd));
    }
}
