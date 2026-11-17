import { ApplicationError } from "../../middleware/errors.js";

const DISPLAY_NAME_LENGTH = 100;
const INPUT_LENGTH = 1_000;
const FALLBACK_DISPLAY_NAME = "Workspace User";

// Why the rule looks like this:
// - Input is cut or refused at INPUT_LENGTH UTF-16 units before any pattern runs, and every pattern is linear.
// - Zero-width joiners, variation selectors and flag tag sequences are default-ignorable, but emoji,
//   Persian, Indic and ideographic-variant names need them, so they stay where they modify a visible
//   neighbour. Any other tag run goes: it hides text that agents still read.
// - A removed character still belongs to the address around it, so an invisible local part cannot hide
//   one. `Team @acme.io` and `@handle` are handles, not addresses, and stay.
// - Length counts code points, as JSON Schema `maxLength` does.
const SPACE_LIKE = /[\p{Cc}\p{Zl}\p{Zp}⠀\u{1D159}]/gu;
const BASE = String.raw`[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cs}�]`;
const INVISIBLE = new RegExp(
  String.raw`(\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,7}\u{E007F}` +
    String.raw`|(?<=${BASE}\p{Variation_Selector}?)\p{Join_Control}(?=${BASE})` +
    String.raw`|(?<=${BASE})\p{Variation_Selector})` +
    String.raw`|[\p{Default_Ignorable_Code_Point}\p{Cs}�]`,
  "gu",
);
const VISIBLE = /[^\p{White_Space}\p{M}\p{Cf}\p{Co}\p{Default_Ignorable_Code_Point}￼]/u;
const AT = String.raw`@﹫＠`;
const WORD = String.raw`[^\p{White_Space}${AT}]`;
const EMAIL = new RegExp(
  String.raw`(?<!${WORD})${WORD}+(?:\p{White_Space}+[${AT}]+\p{White_Space}+|[${AT}]+\p{White_Space}*)${WORD}+[.。．｡]${WORD}`,
  "u",
);
const ADDRESS = new RegExp(String.raw`mailto:|[${AT}]+\p{White_Space}*[^\p{White_Space}${AT}()<>[\]{},;:"']*`, "giu");
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function validDisplayName(value: unknown): string {
  if (typeof value !== "string") throw invalidDisplayName("displayName is required.");
  if (value.length > INPUT_LENGTH || [...value].length > DISPLAY_NAME_LENGTH) {
    throw invalidDisplayName(`displayName must contain between 1 and ${DISPLAY_NAME_LENGTH} characters.`);
  }
  const name = clean(value);
  if (!VISIBLE.test(name)) throw invalidDisplayName("Display name must contain a visible character.");
  if (holdsEmail(value, name)) {
    throw invalidDisplayName("Display name cannot contain an email address. Everyone who opens your shared files sees it.");
  }
  return name;
}

export function deriveDisplayName(value: string | null | undefined, maxLength = DISPLAY_NAME_LENGTH): string {
  const raw = (value ?? "").slice(0, INPUT_LENGTH);
  const name = clean(raw);
  const kept = holdsEmail(raw, name) ? clean(name.replace(ADDRESS, "")) : name;
  const short = clean(shorten(kept, maxLength));
  return VISIBLE.test(short) ? short : "";
}

/** The first candidate that derives a visible name, or `Workspace User`. */
export function deriveUserDisplayName(...candidates: readonly (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const name = deriveDisplayName(candidate);
    if (name) return name;
  }
  return FALLBACK_DISPLAY_NAME;
}

/** A stored name holding an email address, a misleading character or nothing visible. */
export function isUnsafeDisplayName(stored: string): boolean {
  const name = clean(stored);
  return strip(stored) !== stored || !VISIBLE.test(name) || holdsEmail(stored, name);
}

export function personalSpaceName(displayName: string): string {
  return `${displayName} 的个人空间`;
}

function strip(name: string): string {
  return name.replace(SPACE_LIKE, " ").replace(INVISIBLE, (_, kept: string | undefined) => kept ?? "");
}

function clean(name: string): string {
  return strip(name).replace(/\s+/gu, " ").trim();
}

function holdsEmail(raw: string, name: string): boolean {
  return EMAIL.test(name) || EMAIL.test(raw.replace(SPACE_LIKE, " "));
}

function shorten(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;
  let kept = "";
  let length = 0;
  for (const { segment } of graphemes.segment(name)) {
    length += [...segment].length;
    if (length > maxLength) break;
    kept += segment;
  }
  return kept;
}

function invalidDisplayName(message: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, "displayName");
}
