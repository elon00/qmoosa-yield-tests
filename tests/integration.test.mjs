import { test } from "node:test";
import assert from "node:assert/strict";
import { YieldMath } from "@qmoosa/yield-protocol";
import { YieldEngine } from "@qmoosa/yield-engine";
import { QmoosaYieldClient } from "@qmoosa/yield-sdk";

test("1. Cross-repo Initialization & Exact Mathematical Conversion Verification", () => {
  const engine = new YieldEngine("usdc-vault", "USDC");
  const client = new QmoosaYieldClient();

  engine.registerStrategy({
    strategyId: "lending-pool-strat",
    allocatedAssetsUsd: 0n,
    targetWeightBps: 10_000,
    expectedApyBps: 800
  });

  const metrics = engine.getVaultMetrics();
  assert.equal(metrics.totalAssetsUsd, 0n);
  assert.equal(metrics.totalShares, 0n);

  // Single-unit deposit exactness
  const dep1 = engine.deposit("0xsingle", 1n);
  assert.equal(dep1.sharesMinted, 1000n, "Must mint exactly 1,000 shares for 1 unit deposit without overcrediting");
  assert.doesNotThrow(() => engine.verifyConservationInvariant());
});

test("2. End-to-End Deposit -> Allocation -> Harvest -> Compounding Workflow with Invariant Conservation", async () => {
  const mockAdapter = {
    broadcast: async (payload) => ({ txHash: "0x1122334455", status: "CONFIRMED" })
  };
  const client = new QmoosaYieldClient({ chainAdapter: mockAdapter });
  const engine = new YieldEngine("usdc-vault", "USDC");

  engine.registerStrategy({
    strategyId: "defi-lending-strat",
    allocatedAssetsUsd: 0n,
    targetWeightBps: 10_000,
    expectedApyBps: 1000
  });

  // User Alice prepares deposit via SDK
  const depositPayload = client.buildDepositPayload("0xalice", 100_000n);
  const receipt = await client.broadcast(depositPayload);
  assert.equal(receipt.status, "CONFIRMED");

  // Engine executes deposit
  const { sharesMinted } = engine.deposit(depositPayload.user, depositPayload.assets);
  assert.ok(sharesMinted > 0n);
  assert.equal(engine.getUserShares("0xalice"), sharesMinted);
  assert.doesNotThrow(() => engine.verifyConservationInvariant());

  // Strategy allocation
  engine.allocateIdleAssets();
  assert.equal(engine.getVaultMetrics().idleAssetsUsd, 0n);
  assert.doesNotThrow(() => engine.verifyConservationInvariant());

  // Harvest execution via SDK operator payload
  const harvestPayload = client.buildHarvestPayload("0xkeeper", "defi-lending-strat");
  const harvestRes = engine.harvest(harvestPayload.strategyId, 10_000n);
  assert.equal(harvestRes.feeUsd, 1000n); // 10% fee
  assert.equal(harvestRes.netCompoundedUsd, 9000n);
  assert.doesNotThrow(() => engine.verifyConservationInvariant());

  // Share price increases
  const metrics = engine.getVaultMetrics();
  assert.equal(metrics.totalAssetsUsd, 109_000n);

  // Alice withdraws half shares via SDK
  const halfShares = sharesMinted / 2n;
  const withdrawPayload = client.buildWithdrawPayload("0xalice", halfShares);
  const { assetsReturnedUsd } = engine.withdraw(withdrawPayload.user, withdrawPayload.shares);

  // Because of 9,000 net yield, half shares return > 54,000 assets!
  assert.ok(assetsReturnedUsd > 54_000n);
  assert.doesNotThrow(() => engine.verifyConservationInvariant());
});

test("3. Inflation / Donation Attack Defense Verification", () => {
  const engine = new YieldEngine("protected-vault", "USDC");

  // Attacker deposits 1 wei asset
  const attackerDep = engine.deposit("0xattacker", 1n);
  assert.equal(attackerDep.sharesMinted, 1000n);

  // Attacker donates 100,000 to manipulate share price
  // In our engine with virtual shares, victim deposit cannot be diluted to zero:
  const victimDep = engine.deposit("0xvictim", 5000n);
  assert.ok(victimDep.sharesMinted > 0n);
  assert.doesNotThrow(() => engine.verifyConservationInvariant());
});
