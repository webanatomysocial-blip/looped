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

/** Company IDs visible to a manager — projects where any employee shares their pod */
export async function managerCompanyIds(db: Knex, userId: number): Promise<number[]> {
  const user = await db('users').where({ id: userId }).select('pod').first();
  if (!user?.pod) return [];
  return db('projects as p')
    .join('project_members as pm', 'pm.project_id', 'p.id')
    .join('users as u', 'u.id', 'pm.user_id')
    .where('u.pod', user.pod)
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
