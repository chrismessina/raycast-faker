import { test } from "node:test";
import assert from "node:assert/strict";
import { createScrubber } from "../dist/scrub.js";
import { fixtureName } from "../dist/fixtures.js";
import { PEOPLE, PLACES } from "../dist/names.js";

const secrets = { secret: "test-secret", scale: 1.5, dayShift: -3 };
const rules = {
  hosts: ["api.mercury.com"],
  keepHosts: ["app.mercury.com"],
  keep: ["kind", "status", "securityName"],
  names: { counterpartyName: "company", nameOnCard: "person", name: "account" },
  scale: ["amount", "balance", "amountCents"],
};

const REAL_ID = "7fd78a88-fd07-11ee-9c29-6b1bf5108f23";

function sample() {
  return {
    transactions: [
      {
        id: REAL_ID,
        counterpartyName: "Jane Doe",
        amount: -451.4,
        balance: 72864.88,
        status: "sent",
        kind: "debitCardTransaction",
        createdAt: "2026-09-25T15:02:00.000Z",
        postedAt: "2026-09-25",
        note: "Rent for the apartment on Valencia",
        dashboardLink: `https://app.mercury.com/transactions/${REAL_ID}?token=secret`,
        accountNumber: "202200017791",
        securityName: "iShares 0-3 Month Treasury Bond ETF",
      },
    ],
    card: { nameOnCard: "Jane Doe", name: "Mercury Checking ••7791", amountCents: 250000 },
  };
}

test("the same real value always becomes the same fake value", () => {
  const a = createScrubber(rules, secrets).scrub(sample());
  const b = createScrubber(rules, secrets).scrub(sample());
  assert.deepEqual(a, b);
  assert.equal(a.body.transactions[0].id, createScrubber(rules, secrets).mapPath(`/account/${REAL_ID}`).split("/")[2]);
});

test("people and businesses become Twin Peaks names", () => {
  const { body } = createScrubber(rules, secrets).scrub(sample());
  assert.ok(PLACES.includes(body.transactions[0].counterpartyName), body.transactions[0].counterpartyName);
  assert.ok(PEOPLE.includes(body.card.nameOnCard), body.card.nameOnCard);
});

test("no original personal value survives, and nothing is flagged as a leak", () => {
  const result = createScrubber(rules, secrets).scrub(sample());
  const output = JSON.stringify(result.body);
  for (const original of ["Jane Doe", "Valencia", REAL_ID, "202200017791", "7791", "token=secret"]) {
    assert.ok(!output.includes(original), `leaked: ${original}`);
  }
  assert.deepEqual(result.leaks, []);
});

test("kept fields and enums pass through so the extension still works", () => {
  const { body } = createScrubber(rules, secrets).scrub(sample());
  const t = body.transactions[0];
  assert.equal(t.status, "sent");
  assert.equal(t.kind, "debitCardTransaction");
  assert.equal(t.securityName, "iShares 0-3 Month Treasury Bond ETF");
  assert.equal(body.card.name.startsWith("Mercury Checking ••"), true);
});

test("amounts scale by one factor, keeping cents and integers", () => {
  const { body } = createScrubber(rules, secrets).scrub(sample());
  assert.equal(body.transactions[0].amount, -677.1);
  assert.equal(body.transactions[0].balance, 109297.32);
  assert.equal(body.card.amountCents, 375000);
});

test("dates shift together; timestamps also get a few hours of jitter", () => {
  const { body } = createScrubber(rules, secrets).scrub(sample());
  const t = body.transactions[0];
  assert.equal(t.postedAt, "2026-09-22");
  const hours = (new Date(t.createdAt) - new Date("2026-09-22T15:02:00.000Z")) / 3_600_000;
  assert.ok(Math.abs(hours) <= 4, `jitter out of range: ${hours}h`);
});

test("URLs keep their host, map IDs in the path, and drop the query", () => {
  const scrubber = createScrubber(rules, secrets);
  const { body } = scrubber.scrub(sample());
  const url = new URL(body.transactions[0].dashboardLink);
  assert.equal(url.host, "app.mercury.com");
  assert.equal(url.search, "");
  assert.equal(url.pathname, scrubber.mapPath(`/transactions/${REAL_ID}`));
});

test("a value that survives scrubbing is reported as a leak", () => {
  const scrubber = createScrubber({ ...rules, keep: [...rules.keep, "note"] }, secrets);
  const result = scrubber.scrub({ a: { counterpartyName: "Laura Palmer Estate LLC" }, note: "paid Laura Palmer Estate LLC" });
  assert.ok(result.leaks.includes("Laura Palmer Estate LLC"), JSON.stringify(result.leaks));
});

test("fixture names include pagination parameters and nothing else", () => {
  assert.equal(
    fixtureName("GET", "/transactions?limit=500&order=desc&search=chase"),
    fixtureName("GET", "/transactions?limit=500&order=desc"),
  );
  assert.notEqual(
    fixtureName("GET", "/treasury/x/transactions?limit=1000&cursor=2"),
    fixtureName("GET", "/treasury/x/transactions?limit=1000"),
  );
});
