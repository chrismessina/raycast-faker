#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { assertExtensionName, extensionDir, FakerMode, newSecrets, readConfig, writeConfig } from "./config";

const usage = `raycast-faker <record|replay|off|status|clear> [extension]

  record   Real requests; scrubbed copies are saved as fixtures
  replay   Answer from fixtures; unmatched requests fail
  off      Real requests, nothing saved (the default)
  status   Show the mode and where fixtures live
  clear    Delete this extension's fixtures (keeps its secrets)

[extension] defaults to the "name" in ./package.json.`;

const [command, named] = process.argv.slice(2);
const extension =
  named ?? (existsSync("package.json") ? (JSON.parse(readFileSync("package.json", "utf8")) as { name?: string }).name : undefined);

if (!command || !extension) {
  console.log(usage);
  process.exit(command ? 1 : 0);
}

try {
  assertExtensionName(extension);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

// A new config gets its secrets here, once, so two Raycast processes can't each invent their own.
const stored = readConfig(extension);
const config = stored.secret ? stored : { ...stored, ...newSecrets() };
if (command === "record" || command === "replay" || command === "off") {
  writeConfig(extension, { ...config, mode: command as FakerMode });
  console.log(`${extension}: ${command}. Takes effect on the next request; reopen the command to be sure.`);
} else if (command === "status") {
  console.log(`${extension}: ${config.mode}\nFixtures: ${join(extensionDir(extension), "fixtures")}`);
} else if (command === "clear") {
  rmSync(join(extensionDir(extension), "fixtures"), { recursive: true, force: true });
  rmSync(join(extensionDir(extension), "refused.json"), { force: true });
  console.log(`${extension}: fixtures cleared.`);
} else {
  console.log(usage);
  process.exit(1);
}
