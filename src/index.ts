import { readConfig } from "./config";
import { fixtureName, readFixture, recordRefusal, writeFixture } from "./fixtures";
import { createScrubber, FakerRules } from "./scrub";

export type { FakerRules } from "./scrub";
export type { FakerMode } from "./config";

type Fetch = typeof fetch;

interface RaycastEnvironment {
  isDevelopment: boolean;
  extensionName: string;
}

/** Raycast's environment, or undefined outside a Raycast host (tests, the CLI). */
function raycastEnvironment(): RaycastEnvironment | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { environment } = require("@raycast/api") as { environment?: RaycastEnvironment };
    return environment?.extensionName ? environment : undefined;
  } catch {
    return undefined;
  }
}

/** The active mode, or `off`. Only a development build can be in anything but `off`. */
function activeMode(): { mode: "record" | "replay"; extension: string } | undefined {
  const environment = raycastEnvironment();
  if (!environment?.isDevelopment) return undefined;
  const { mode } = readConfig(environment.extensionName);
  return mode === "off" ? undefined : { mode, extension: environment.extensionName };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Wrap the `fetch` an extension uses for its API. In a Store build this returns `fetch` itself.
 * In a development build it records scrubbed fixtures, or replays them, per the extension's
 * config in ~/.config/raycast-faker/<extensionName>/config.json.
 */
export function withFaker(fetchImpl: Fetch, rules: FakerRules): Fetch {
  const environment = raycastEnvironment();
  if (!environment?.isDevelopment) return fetchImpl;

  return async (input, init) => {
    const active = activeMode();
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!active || !rules.hosts.includes(url.host)) return fetchImpl(input, init);

    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    const config = readConfig(active.extension);

    if (active.mode === "replay") {
      // Requests in replay already carry fake IDs, taken from the fake lists they came from.
      const fixture = readFixture(active.extension, url.host, fixtureName(method, url.pathname + url.search));
      if (fixture) return json(fixture.status, fixture.body);
      // Fail rather than fall through: a screen that quietly fetched real data is what this prevents.
      return json(404, { errors: { message: `raycast-faker: no fixture for ${method} ${url.pathname}` } });
    }

    const response = await fetchImpl(input, init);
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("json")) return response;

    const scrubber = createScrubber(rules, config);
    const body = await response.clone().json();
    const scrubbed = scrubber.scrub(body);
    const mapped = new URL(url.href);
    mapped.pathname = scrubber.mapPath(url.pathname);
    // Page cursors that are IDs get the same fake ID the body gave them; numeric cursors stay as they are.
    for (const [key, value] of url.searchParams) mapped.searchParams.set(key, scrubber.mapId(value));

    if (scrubbed.leaks.length > 0) {
      // Field names only, never values, so the report is safe to keep and to share.
      recordRefusal(active.extension, `${method} ${mapped.pathname}`, scrubbed.leakFields);
      console.warn(
        `[raycast-faker] Not saving ${method} ${url.pathname}: values from ${scrubbed.leakFields.join(", ")} survived scrubbing. See refused.json.`,
      );
    } else {
      writeFixture(active.extension, url.host, fixtureName(method, mapped.pathname + mapped.search), {
        status: response.status,
        body: scrubbed.body,
      });
    }
    return response;
  };
}

/**
 * A LocalStorage key, moved to a separate namespace while replaying. Replay then starts from an
 * empty store: no real logins, no cached real balances. Record and off use the real store.
 */
export function fakerKey(key: string): string {
  return activeMode()?.mode === "replay" ? `raycast-faker:${key}` : key;
}

/** True while replaying: for requests an extension makes outside `withFaker` (downloads) and must refuse. */
export function isReplaying(): boolean {
  return activeMode()?.mode === "replay";
}
