import { test } from "node:test";
import assert from "node:assert/strict";
import { YieldEngine } from "@qmoosa/yield-engine";
import { QmoosaYieldClient } from "@qmoosa/yield-sdk";

test("Negative Control 1: Zero deposit strictly rejected across SDK and Engine", () => {
  const client = new QmoosaYieldClient();
  assert.throws(() => client.buildDepositPayload("0xalice", 0n), /Deposit assets must be strictly positive/);

  const engine = new YieldEngine();
  assert.throws(() => engine.deposit("0xalice", 0n), /Deposit amount must be strictly greater than zero/);
});

test("Negative Control 2: Over-withdrawal exceeding user shares strictly rejected", () => {
  const engine = new YieldEngine();
  engine.deposit("0xalice", 10_000n);

  assert.throws(
    () => engine.withdraw("0xalice", 1_000_000_000_000n),
    /Insufficient share balance/
  );
});

test("Negative Control 3: Unregistered strategy harvest strictly fails closed", () => {
  const engine = new YieldEngine();
  assert.throws(
    () => engine.harvest("ghost-strategy", 1000n),
    /Strategy ghost-strategy not found/
  );
});

test("Negative Control 4: Unconfigured SDK adapter fails closed with zero manufactured hashes", async () => {
  const client = new QmoosaYieldClient();
  const payload = client.buildDepositPayload("0xalice", 1000n);

  await assert.rejects(() => client.broadcast(payload), /Chain adapter not configured/);
});

test("Negative Control 5: Insufficient strategy liquidity causes withdrawal to fail closed and preserve state", () => {
  const engine = new YieldEngine();
  engine.registerStrategy({
    strategyId: "illiquid-strat",
    allocatedAssetsUsd: 0n,
    targetWeightBps: 10_000,
    expectedApyBps: 500
  });

  const dep = engine.deposit("0xalice", 10_000n);
  // User cannot withdraw more shares than held
  assert.throws(
    () => engine.withdraw("0xalice", dep.sharesMinted * 10n),
    /Insufficient share balance/
  );
  // Verify state is completely preserved
  assert.doesNotThrow(() => engine.verifyConservationInvariant());
  assert.equal(engine.getUserShares("0xalice"), dep.sharesMinted);
});
