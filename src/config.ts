import { randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FakerSecrets } from "./scrub";

export type FakerMode = "off" | "record" | "replay";

export interface FakerConfig extends FakerSecrets {
  mode: FakerMode;
}

/** An extension name is used as a folder name, so it must be one plain path component. */
export function assertExtensionName(extension: string) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(extension) || extension.includes("..")) {
    throw new Error(`"${extension}" isn't a valid extension name.`);
  }
}

/**
 * Outside every extension folder on purpose: `ray publish` ships everything inside one, and
 * fixtures (even scrubbed) don't belong in the Store.
 */
export function extensionDir(extension: string) {
  assertExtensionName(extension);
  return join(homedir(), ".config", "raycast-faker", extension);
}

/** Fresh secrets, generated once when a config is first created. */
export function newSecrets(): FakerSecrets {
  return {
    secret: randomBytes(32).toString("hex"),
    // Two decimals, between 0.40 and 1.60: magnitudes change, the shape of the history doesn't.
    scale: randomInt(40, 161) / 100,
    // One to six days earlier, so recent activity still reads as recent.
    dayShift: -randomInt(1, 7),
  };
}

function configPath(extension: string) {
  return join(extensionDir(extension), "config.json");
}

let cache: { extension: string; mtimeMs: number; config: FakerConfig } | undefined;

/** The extension's config, created with fresh secrets on first read. Missing means `off`. */
export function readConfig(extension: string): FakerConfig {
  const path = configPath(extension);
  if (!existsSync(path)) return { mode: "off", secret: "", scale: 1, dayShift: 0 };
  const mtimeMs = statSync(path).mtimeMs;
  if (cache?.extension === extension && cache.mtimeMs === mtimeMs) return cache.config;

  const stored = JSON.parse(readFileSync(path, "utf8")) as Partial<FakerConfig>;
  // A config written without secrets (by hand) gets them once, here. The CLI always writes them.
  const complete = Boolean(stored.secret && stored.scale && stored.dayShift);
  const config: FakerConfig = {
    mode: stored.mode === "record" || stored.mode === "replay" ? stored.mode : "off",
    ...(complete ? { secret: stored.secret!, scale: stored.scale!, dayShift: stored.dayShift! } : newSecrets()),
  };
  if (!complete) writeConfig(extension, config);
  cache = { extension, mtimeMs: existsSync(path) ? statSync(path).mtimeMs : mtimeMs, config };
  return config;
}

export function writeConfig(extension: string, config: FakerConfig) {
  mkdirSync(extensionDir(extension), { recursive: true });
  writeFileSync(configPath(extension), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}
