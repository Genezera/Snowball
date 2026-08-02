/** Parser minimo de --flag valor / --flag=valor / --flag booleano. */
export function parseArgs(argv = process.argv.slice(2)): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

export const num = (v: unknown, d: number): number => (v == null ? d : Number(v));
export const str = (v: unknown, d: string): string => (v == null || v === true ? d : String(v));
export const bool = (v: unknown, d: boolean): boolean =>
  v == null ? d : v === true || v === 'true' || v === '1';

/** `--params "fast=20,slow=50,stopPct=0.015"` -> objeto. */
export function parseParams(s: string | boolean | undefined): Record<string, number | boolean> {
  if (!s || s === true) return {};
  const out: Record<string, number | boolean> = {};
  for (const part of String(s).split(',')) {
    const [k, v] = part.split('=');
    if (!k || v == null) continue;
    out[k.trim()] = v === 'true' ? true : v === 'false' ? false : Number(v);
  }
  return out;
}
