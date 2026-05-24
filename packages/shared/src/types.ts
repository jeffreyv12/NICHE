// Cross-package primitive types. Behavioural types live next to their owning module.

/** A non-empty string. Use the constructor for runtime checks. */
export type NonEmptyString = string & { __brand: 'NonEmptyString' };

export const asNonEmpty = (s: string): NonEmptyString => {
  if (s.length === 0) throw new Error('expected non-empty string');
  return s as NonEmptyString;
};

/** ISO-8601 date string (no time). */
export type IsoDate = string & { __brand: 'IsoDate' };

/** ISO-8601 timestamp. */
export type IsoTimestamp = string & { __brand: 'IsoTimestamp' };

/** Slug — lowercase letters, digits, hyphens. */
export type Slug = string & { __brand: 'Slug' };

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const asSlug = (s: string): Slug => {
  if (!SLUG_RE.test(s)) {
    throw new Error(`invalid slug: ${s}`);
  }
  return s as Slug;
};

export const toSlug = (s: string): Slug =>
  asSlug(
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
  );
