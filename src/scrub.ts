import { createHmac } from "node:crypto";
import { LINES, PEOPLE, PLACES } from "./names";

export interface FakerRules {
  /** Hosts whose requests are recorded and replayed. Everything else passes through untouched. */
  hosts: string[];
  /** Field names kept verbatim: enums, public data (fund names), anything the extension's logic reads. */
  keep?: string[];
  /** Field names kept only when the value matches, e.g. Treasury's "Dividend posted: …" descriptions. */
  keepIf?: Record<string, RegExp>;
  /** URL hosts kept as they are, besides `hosts`. Any other host becomes example.com. */
  keepHosts?: string[];
  /** Words that may stay in an account-style name, besides the built-in banking vocabulary. */
  safeWords?: string[];
  /** Field names that hold names, and what kind: a person, a business, or an account ("Checking ••7791"). */
  names?: Record<string, "person" | "company" | "account">;
  /** Numeric field names multiplied by the hidden scale factor. */
  scale?: string[];
}

export interface FakerSecrets {
  /** Random per extension; fakes are derived from it, so no real-to-fake table is ever stored. */
  secret: string;
  /** Multiplier for amounts, chosen once per extension. */
  scale: number;
  /** Days every date moves by, chosen once per extension. */
  dayShift: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const URL_LIKE = /^https?:\/\//i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DIGITS = /^[\d\s-]{4,}$/;
/** Numbers under these field names are money and get scaled, whether or not the rules list them. */
// Not "total" or a bare "limit": in API responses those are usually counts.
const MONEY = /amount|balance|fee|price|cost|cents|salary|income|spend|.limit/i;
/**
 * Words that identify no one and may stay in an account-style name ("Mercury Savings ••6333"). A
 * name with any other word is replaced whole. They're also skipped by the word-level leak check.
 */
const SAFE_WORDS = new Set(
  (
    "mercury checking savings treasury credit card debit account accounts operating reserve reserves " +
    "payroll tax taxes payment payments interest earned transfer transfers fees fee expenses expense " +
    "income revenue business personal primary main joint emergency fund funds investment investments " +
    "invest bank ach wire deposit deposits other general spending bills rent travel meals software"
  ).split(" "),
);
/** Values this short can't identify anyone and are often codes ("CA", "US"). */
const SHORT = 2;
/** Originals shorter than this aren't checked for leaks; they'd match by coincidence. */
const LEAK_MIN = 4;
const JITTER_HOURS = 4;

export interface ScrubResult<T> {
  body: T;
  /** Original values that still appear in the output. A non-empty list means don't write it. */
  leaks: string[];
}

export function createScrubber(rules: FakerRules, secrets: FakerSecrets) {
  const keep = new Set(rules.keep ?? []);
  const keepIf = rules.keepIf ?? {};
  const keepHosts = new Set([...rules.hosts, ...(rules.keepHosts ?? [])]);
  const safeWords = new Set([...SAFE_WORDS, ...(rules.safeWords ?? []).map((word) => word.toLowerCase())]);
  // Any script, not just ASCII: "张伟" is one word, and not a banking word.
  const words = (value: string) => value.toLowerCase().match(/\p{L}+/gu) ?? [];
  /** A rule for `parent.key` wins over one for `key`, so `merchantLock.name` can differ from `name`. */
  const ruleFor = <T>(map: Record<string, T>, key: string | undefined, parent: string | undefined) =>
    key === undefined ? undefined : ((parent !== undefined ? map[`${parent}.${key}`] : undefined) ?? map[key]);
  const names = rules.names ?? {};
  const scale = new Set(rules.scale ?? []);

  const digest = (value: string, salt: string) => createHmac("sha256", secrets.secret).update(`${salt}:${value}`).digest();
  const pick = <T>(list: T[], value: string, salt: string) => list[digest(value, salt).readUInt32BE(0) % list.length];

  function fakeDigits(value: string) {
    const bytes = digest(value, "digits");
    let i = 0;
    return value.replace(/\d/g, () => String(bytes[i++ % bytes.length] % 10));
  }

  function fakeUuid(value: string) {
    const hex = digest(value.toLowerCase(), "uuid").toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  /** Map the parts of a path that identify something: UUIDs and digit runs. */
  function mapSegment(segment: string) {
    if (UUID.test(segment)) return fakeUuid(segment);
    if (/^\d{4,}$/.test(segment)) return fakeDigits(segment);
    return segment;
  }

  function mapPath(path: string) {
    return path
      .split("/")
      .map((segment) => mapSegment(decodeURIComponent(segment)))
      .join("/");
  }

  function shiftDate(value: string) {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + secrets.dayShift);
    return date.toISOString().slice(0, 10);
  }

  function shiftTimestamp(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const jitterMinutes = (digest(value, "jitter").readUInt16BE(0) % (JITTER_HOURS * 120 + 1)) - JITTER_HOURS * 60;
    date.setUTCMinutes(date.getUTCMinutes() + secrets.dayShift * 24 * 60 + jitterMinutes);
    return date.toISOString();
  }

  function fakeString(
    key: string | undefined,
    parent: string | undefined,
    value: string,
    originals: Set<string>,
    nameWords: Set<string>,
  ): string {
    if (key && (keep.has(key) || (parent !== undefined && keep.has(`${parent}.${key}`)))) return value;
    if (ruleFor(keepIf, key, parent)?.test(value)) return value;
    const kind = ruleFor(names, key, parent);
    // Short ASCII values are codes ("CA", "US"). A short name ("张伟" is two characters) is still a name.
    if (!kind && value.length <= SHORT && /^[\x20-\x7e]*$/.test(value)) return value;
    if (DATE.test(value)) return shiftDate(value);
    if (TIMESTAMP.test(value)) return shiftTimestamp(value);

    const replaced = (fake: string) => {
      if (fake !== value && value.length >= LEAK_MIN) originals.add(value);
      return fake;
    };
    // A person's or business's name can leak in parts ("Payment to Jane"), so each word is checked too.
    const replacedName = (fake: string) => {
      for (const word of words(value)) if (word.length >= LEAK_MIN && !safeWords.has(word)) nameWords.add(word);
      return replaced(fake);
    };

    if (UUID.test(value)) return replaced(fakeUuid(value));
    if (URL_LIKE.test(value)) {
      try {
        const url = new URL(value);
        const origin = keepHosts.has(url.host) ? url.origin : "https://example.com";
        return replaced(`${origin}${mapPath(url.pathname)}`);
      } catch {
        return replaced(pick(LINES, value, "line"));
      }
    }
    if (EMAIL.test(value)) {
      const [first, last = "cooper"] = pick(PEOPLE, value, "person").toLowerCase().split(" ");
      return replaced(`${first}.${last.replace(/[^a-z]/g, "")}@example.com`);
    }
    if (kind === "person") return replacedName(pick(PEOPLE, value, "person"));
    if (kind === "company") return replacedName(pick(PLACES, value, "company"));
    // "Mercury Checking ••7791": banking words stay and digits change. A name with any other word
    // ("Chris Family Expenses") could identify someone, so it's replaced whole.
    if (kind === "account") {
      return words(value).every((word) => safeWords.has(word))
        ? replaced(fakeDigits(value))
        : replacedName(pick(PLACES, value, "account"));
    }
    if (DIGITS.test(value)) return replaced(fakeDigits(value));
    return replaced(pick(LINES, value, "line"));
  }

  function scaleNumber(value: number) {
    const scaled = value * secrets.scale;
    return Number.isInteger(value) ? Math.round(scaled) : Math.round(scaled * 100) / 100;
  }

  function walk(
    value: unknown,
    key: string | undefined,
    parent: string | undefined,
    originals: Set<string>,
    nameWords: Set<string>,
  ): unknown {
    if (typeof value === "string") return fakeString(key, parent, value, originals, nameWords);
    if (typeof value === "number") return key && (scale.has(key) || MONEY.test(key)) ? scaleNumber(value) : value;
    if (Array.isArray(value)) return value.map((item) => walk(item, key, parent, originals, nameWords));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k, key, originals, nameWords)]));
    }
    return value;
  }

  return {
    /** Replace personal data in a JSON body, and report any original value that survived. */
    scrub<T>(body: T): ScrubResult<T> {
      const originals = new Set<string>();
      const nameWords = new Set<string>();
      const scrubbed = walk(body, undefined, undefined, originals, nameWords) as T;
      // Case-insensitive, and word by word for names, so "JANE DOE" and "Payment to Jane" are caught.
      const output = JSON.stringify(scrubbed).toLowerCase();
      const outputWords = new Set(words(output));
      const leaks = [
        ...[...originals].filter((original) => output.includes(original.toLowerCase())),
        ...[...nameWords].filter((word) => outputWords.has(word)),
      ];
      return { body: scrubbed, leaks };
    },
    /** A request path with its identifying segments mapped the same way bodies are. */
    mapPath,
    /** A UUID's fake counterpart; anything else unchanged. */
    mapId: (value: string) => (UUID.test(value) ? fakeUuid(value) : value),
  };
}
