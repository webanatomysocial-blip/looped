import { Knex } from 'knex';

/** Company IDs visible to an employee — projects they're a member of */
export async function employeeCompanyIds(db: Knex, userId: number): Promise<number[]> {
  return db('projects as p')
    .join('project_members as pm', 'pm.project_id', 'p.id')
    .where('pm.user_id', userId)
    .whereNotNull('p.client_company_id')
    .distinct('p.client_company_id')
    .pluck('p.client_company_id');
}

/** Company IDs visible to a manager — projects assigned to their pod */
export async function managerCompanyIds(db: Knex, userId: number): Promise<number[]> {
  const user = await db('users').where({ id: userId }).select('pod').first();
  if (!user?.pod) return [];
  return db('projects as p')
    .where('p.pod', user.pod)
    .whereNotNull('p.client_company_id')
    .distinct('p.client_company_id')
    .pluck('p.client_company_id');
}

/** Resolve visible company IDs based on role. Admin = null (unrestricted). */
export async function visibleCompanyIds(db: Knex, role: string, userId: number): Promise<number[] | null> {
  if (role === 'admin') return null;
  if (role === 'manager') return managerCompanyIds(db, userId);
  if (role === 'employee') return employeeCompanyIds(db, userId);
  return [];
}

/** SEO employees (category name contains "SEO") work on every client's SEO reports */
export async function isSeoEmployee(db: Knex, role: string, userId: number): Promise<boolean> {
  if (role !== 'employee') return false;
  const names: string[] = await db('user_categories as uc').join('employee_categories as ec', 'uc.category_id', 'ec.id').where('uc.user_id', userId).pluck('ec.name');
  return names.some((n) => /seo/i.test(n));
}

/** Company IDs visible on SEO pages: like visibleCompanyIds, but SEO employees see all (null) */
export async function seoVisibleCompanyIds(db: Knex, role: string, userId: number): Promise<number[] | null> {
  return (await isSeoEmployee(db, role, userId)) ? null : visibleCompanyIds(db, role, userId);
}
