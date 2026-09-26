import { test } from "node:test";
import assert from "node:assert/strict";
import { createScrubber } from "../dist/scrub.js";
import { assertExtensionName } from "../dist/config.js";

const secrets = { secret: "test-secret", scale: 1.5, dayShift: -3 };
const base = {
  hosts: ["api.mercury.com"],
  keepHosts: ["app.mercury.com"],
  keep: ["status"],
  keepIf: { description: /^[A-Z][a-z]+(?: [a-z]+)* posted(?::.*)?$/ },
  names: { counterpartyName: "company", name: "account" },
  scale: ["amount"],
};
const scrub = (body, rules = base) => createScrubber(rules, secrets).scrub(body);

test("an unlisted CamelCase value is not treated as an enum", () => {
  const { body } = scrub({ recipientHandle: "JaneDoe", status: "sent" });
  assert.notEqual(body.recipientHandle, "JaneDoe");
  assert.equal(body.status, "sent");
});

test("account names keep common banking words only", () => {
  const { body } = scrub({ a: { name: "Mercury Savings ••6333" }, b: { name: "Chris Family Expenses" } });
  assert.match(body.a.name, /^Mercury Savings ••\d{4}$/);
  assert.ok(!/chris|family/i.test(body.b.name), body.b.name);
});

test("money fields are scaled even when the rules don't list them", () => {
  const { body } = scrub({ minimumBalance: 250000, spendLimitCents: 1000, count: 7 });
  assert.equal(body.minimumBalance, 375000);
  assert.equal(body.spendLimitCents, 1500);
  assert.equal(body.count, 7);
});

test("the leak check is case-insensitive and catches parts of a name", () => {
  const rules = { ...base, keep: ["status", "note"] };
  assert.ok(scrub({ counterpartyName: "Jane Doe", note: "Payment to JANE DOE" }, rules).leaks.length > 0);
  assert.ok(scrub({ counterpartyName: "Jane Doe", note: "Payment to Jane" }, rules).leaks.length > 0);
  // Common banking words in a replaced name don't count as a leak.
  assert.deepEqual(scrub({ counterpartyName: "Mercury Checking ••7791", a: { name: "Mercury Checking ••2923" } }).leaks, []);
});

test("only declared hosts keep their origin", () => {
  const { body } = scrub({ a: "https://app.mercury.com/transactions/x", b: "https://acme-receipts.s3.amazonaws.com/r/1.pdf?sig=1" });
  assert.equal(new URL(body.a).host, "app.mercury.com");
  assert.equal(new URL(body.b).host, "example.com");
});

test("keepIf keeps a field only when it matches", () => {
  const { body } = scrub({
    x: { description: "Dividend posted: cusip:46436E718 (iShares 0-3 Month Treasury Bond ETF)" },
    y: { description: "Wire to Jane Doe, 123 Main Street" },
  });
  assert.equal(body.x.description, "Dividend posted: cusip:46436E718 (iShares 0-3 Month Treasury Bond ETF)");
  assert.ok(!/jane|main street/i.test(body.y.description), body.y.description);
});

test("extension names must be a single safe path component", () => {
  assert.doesNotThrow(() => assertExtensionName("mercury"));
  for (const bad of ["..", "../x", "a/b", "", ".hidden"]) assert.throws(() => assertExtensionName(bad), bad);
});

test("names in any script are replaced, not just ASCII", () => {
  const { body, leaks } = scrub({ a: { name: "张伟" }, counterpartyName: "Zoë Łukasz" });
  assert.notEqual(body.a.name, "张伟");
  assert.ok(!JSON.stringify(body).includes("Łukasz"));
  assert.deepEqual(leaks, []);
});

test("a parent.key rule wins over a plain key rule", () => {
  const rules = { ...base, names: { ...base.names, "merchantLock.name": "company" } };
  const { body } = scrub({ merchantLock: { name: "Mercury Payments" }, account: { name: "Mercury Savings ••6333" } }, rules);
  assert.notEqual(body.merchantLock.name, "Mercury Payments");
  assert.match(body.account.name, /^Mercury Savings ••\d{4}$/);
});

test("counts are not scaled as money", () => {
  const { body } = scrub({ total: 30, limit: 500, creditLimit: 1000 });
  assert.equal(body.total, 30);
  assert.equal(body.limit, 500);
  assert.equal(body.creditLimit, 1500);
});

test("a refusal names the fields a leaked value came from, never the value", () => {
  const rules = { ...base, keep: ["status", "note"] };
  const result = scrub({ counterpartyName: "Jane Doe", note: "Payment to JANE DOE" }, rules);
  assert.deepEqual(result.leakFields, ["counterpartyName"]);
  assert.ok(!JSON.stringify(result.leakFields).toLowerCase().includes("jane"));
});

test("no false leak when a value reappears only in a fake name, a public enum, or a keepIf field", () => {
  const rules = { ...base, keep: ["status", "mercuryCategory"], names: { ...base.names, "categoryData.name": "account" } };
  // A custom category named like one of Mercury's own is a public term, not personal data.
  assert.deepEqual(scrub({ mercuryCategory: "Restaurants", categoryData: { name: "Restaurants" } }, rules).leakFields, []);
  // A merchant word that happens to be in a Twin Peaks place name isn't a leak.
  assert.deepEqual(scrub({ counterpartyName: "Lodge Insurance Co", other: "Great Northern Hotel" }, rules).leakFields, []);
  // A value that also appears inside a keepIf-validated (public) field isn't a leak.
  assert.deepEqual(
    scrub({ x: { description: "Dividend posted: cusip:X (iShares Bond ETF)" }, y: { additionalDetails: "iShares Bond ETF" } }).leakFields,
    [],
  );
});
