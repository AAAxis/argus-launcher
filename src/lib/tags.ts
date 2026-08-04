// Matching a stored tag to the catalog, and the one place the 5-tag cap is
// enforced.
//
// Tags are free text the user has been typing since before there was a catalog,
// so "Instagram", "instagram" and "Tik Tok" all have to reach the right mark
// without anything rewriting what is already in the column. Hence a key rather
// than an equality test: strip case and punctuation, then look the key up.
import {MAX_PROFILE_TAGS, TAG_PRESETS} from '../data/tagPresets';
import type {TagPresetWithLogo} from '../data/tagPresets';

export {MAX_PROFILE_TAGS};

// "Tik Tok", "TikTok", "tik-tok" -> "tiktok". Also what the tag filter and the
// folder suggestions compare on, so one brand is never two entries in a list.
export function tagKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BY_KEY = new Map<string, TagPresetWithLogo>();
for (const preset of TAG_PRESETS) {
  BY_KEY.set(tagKey(preset.slug), preset);
  for (const alias of preset.aliases || []) {
    BY_KEY.set(tagKey(alias), preset);
  }
}

export function tagPresetFor(value: string): TagPresetWithLogo | undefined {
  return BY_KEY.get(tagKey(value));
}

// What a tag is called in a list: the catalog's spelling when it recognizes the
// tag, otherwise the user's own, untouched.
export function tagLabel(value: string): string {
  return tagPresetFor(value)?.label || value;
}

// The one enforcement point. Every write path into profiles.tags goes through
// this -- the editor, the CSV import and the automation bridge -- so a row can
// never carry more tags than the editor is willing to show.
export function normalizeTags(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const value of values) {
    const tag = String(value || '').trim();
    const key = tagKey(tag);
    // A tag of pure punctuation keys to "" and would collapse every other one
    // like it into a single entry, so it is dropped rather than deduped.
    if (!tag || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    list.push(tag);
    if (list.length === MAX_PROFILE_TAGS) {
      break;
    }
  }
  return list;
}

export type TagUsage = {
  tag: string;
  count: number;
  // Set when the catalog recognizes the tag, which is also how the picker and
  // the folder suggestions tell a user's own word from a brand.
  preset?: TagPresetWithLogo;
};

// Every distinct tag in use across a set of profiles, most used first, with the
// user's own tags ahead of the ones the catalog already offers. Feeds both the
// picker (where "your tags first" is the point) and the table's filter.
export function tagsInUse(
    profiles: Array<{tags?: string[]; deleted_at?: string | null}>): TagUsage[] {
  const counts = new Map<string, {tag: string; count: number}>();
  for (const profile of profiles) {
    if (profile.deleted_at) {
      continue;
    }
    for (const raw of normalizeTags(profile.tags || [])) {
      const key = tagKey(raw);
      const entry = counts.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        counts.set(key, {tag: raw, count: 1});
      }
    }
  }
  return [...counts.values()]
      .map((entry) => ({...entry, preset: tagPresetFor(entry.tag)}))
      .sort((a, b) => {
        const own = Number(Boolean(a.preset)) - Number(Boolean(b.preset));
        return own || b.count - a.count || a.tag.localeCompare(b.tag);
      });
}
