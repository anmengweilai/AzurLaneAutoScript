export type TranslationMap = Record<string, any>;

export function translate(map: TranslationMap | undefined, key: string, fallback?: string) {
  const value = key.split('.').reduce<any>(
    (current, part) => (current && typeof current === 'object' ? current[part] : undefined),
    map || {},
  );
  if (typeof value === 'string') {
    return value;
  }
  return fallback ?? key;
}
