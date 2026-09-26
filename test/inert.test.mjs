import { test } from "node:test";
import assert from "node:assert/strict";
import { withFaker, fakerKey } from "../dist/index.js";

// Outside a Raycast development build (here: no Raycast host at all), the kit must do nothing.
test("withFaker returns the original fetch outside development", () => {
  const original = async () => new Response("real");
  assert.equal(withFaker(original, { hosts: ["api.mercury.com"] }), original);
});

test("fakerKey returns the key unchanged outside development", () => {
  assert.equal(fakerKey("mercury-logins"), "mercury-logins");
});
