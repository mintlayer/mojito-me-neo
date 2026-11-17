// Central strings module: flat dot namespaced keys and {name} interpolation
// through t(). English only today (decision D7); setLocale plus the registry
// keep later locales a data change, not a code change.
import { en } from './strings/en';

export type I18nKey = keyof typeof en;

type Dictionary = Partial<Record<I18nKey, string>>;

const registry: Record<string, Dictionary> = { en };

let current = 'en';

/** Switch the active locale; unknown locales keep the previous one. */
export function setLocale(locale: string): void {
  if (locale in registry) current = locale;
}

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  const dict = registry[current] ?? en;
  const raw = dict[key] ?? en[key];
  if (raw === undefined) throw new Error(`missing translation: ${key}`);
  if (!vars) return raw;
  let out = raw;
  for (const [name, value] of Object.entries(vars)) {
    out = out.split(`{${name}}`).join(String(value));
  }
  return out;
}
