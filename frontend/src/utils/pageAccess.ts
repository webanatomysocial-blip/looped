// Category-gated pages: employees need a matching category (or an explicit page permission).
// Shared by the route guards (App.tsx) and the sidebar so a visible link never bounces.
const hasCategory = (u: any, re: RegExp) => u?.categories?.some((c: any) => re.test(c.name)) ?? false;

export const canSeeSeo = (u: any) => u?.role !== 'employee' || hasCategory(u, /seo/i);
export const canSeeAds = (u: any) => u?.role !== 'employee' || hasCategory(u, /ads/i);

const CATEGORY_GATES: Record<string, (u: any) => boolean> = { '/seo': canSeeSeo, '/ads': canSeeAds };

export function passesCategoryGate(u: any, path: string): boolean {
  if (u?.page_permissions?.includes(path)) return true;
  const gate = CATEGORY_GATES[path];
  return gate ? gate(u) : true;
}
