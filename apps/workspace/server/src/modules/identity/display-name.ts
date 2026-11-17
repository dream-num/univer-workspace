import { ApplicationError } from "../../middleware/errors.js";

const DISPLAY_NAME_LENGTH = 100;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/u;
const ADDRESS_TAIL = /@[^\s@()<>[\]{},;:"']*/gu;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function validDisplayName(value: unknown): string {
  if (typeof value !== "string") throw invalidDisplayName("displayName is required.");
  const name = clean(value);
  if (!name) throw invalidDisplayName("Display name must contain a visible character.");
  if (EMAIL.test(name)) {
    throw invalidDisplayName("Display name cannot contain an email address. Everyone who opens your shared files sees it.");
  }
  if (name.length > DISPLAY_NAME_LENGTH) {
    throw invalidDisplayName(`displayName must contain between 1 and ${DISPLAY_NAME_LENGTH} characters.`);
  }
  return name;
}

export function deriveDisplayName(name: string | null | undefined, maxLength = DISPLAY_NAME_LENGTH): string {
  return shorten(withoutEmails(clean(name ?? "")), maxLength);
}

export function personalSpaceName(displayName: string): string {
  return `${displayName} 的个人空间`;
}

function clean(name: string): string {
  return name
    .replace(/[\p{Cc}\p{Zl}\p{Zp}⠀]/gu, " ")
    .replace(/[\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}�]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function withoutEmails(name: string): string {
  return EMAIL.test(name) ? name.replace(ADDRESS_TAIL, "").replace(/\s+/gu, " ").trim() : name;
}

function shorten(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;
  let kept = "";
  for (const { segment } of graphemes.segment(name)) {
    if (kept.length + segment.length > maxLength) break;
    kept += segment;
  }
  return kept.trim();
}

function invalidDisplayName(message: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, "displayName");
}
