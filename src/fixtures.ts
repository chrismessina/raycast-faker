import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extensionDir } from "./config";

/** Query parameters that pick a page. They're part of a fixture's name so page 2 isn't a replay of page 1. */
const PAGING = ["start_after", "end_before", "cursor", "offset"];

/**
 * A fixture's file name: method, path, and paging parameters. Every other query parameter
 * (search, filters, limits) is ignored, so a replayed search returns the recorded list.
 */
export function fixtureName(method: string, pathWithQuery: string): string {
  const url = new URL(pathWithQuery, "https://fixture.invalid");
  const paging = PAGING.filter((key) => url.searchParams.has(key))
    .map((key) => `${key}=${url.searchParams.get(key)}`)
    .join("&");
  return encodeURIComponent(`${method.toUpperCase()} ${url.pathname}${paging ? `?${paging}` : ""}`) + ".json";
}

export interface Fixture {
  status: number;
  body: unknown;
}

function fixturePath(extension: string, host: string, name: string) {
  return join(extensionDir(extension), "fixtures", host, name);
}

export function readFixture(extension: string, host: string, name: string): Fixture | undefined {
  const path = fixturePath(extension, host, name);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Fixture) : undefined;
}

export function writeFixture(extension: string, host: string, name: string, fixture: Fixture) {
  const path = fixturePath(extension, host, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
}

export { PAGING };
