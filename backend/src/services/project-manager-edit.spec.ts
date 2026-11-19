/// <reference types="node" />
// A manager editing a project's team (was refused with "Managers can only add employees")
process.env.SQLITE_FILE = ':memory:';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import { updateProject } from './projects';
const db = () => getDB(); const U: any = {};
before(async () => {
  await initDB();
  for (const [k, role] of [['ad', 'admin'], ['ad2', 'admin'], ['m', 'manager'], ['m2', 'manager'], ['e', 'employee'], ['e2', 'employee']])
    U[k] = (await db()('users').insert({ name: k, email: `${k}@pm.t`, password_hash: 'x', role, pod: 'pod1' }))[0];
  U.P = (await db()('projects').insert({ name: 'P', pod: 'pod1', created_by: U.ad, status: 'active', manager_status: 'accepted' }))[0];
  for (const u of [U.ad, U.m, U.e]) await db()('project_members').insert({ project_id: U.P, user_id: u });
});
after(() => db().destroy());
const members = async () => (await db()('project_members').where({ project_id: U.P }).pluck('user_id')).map(Number).sort((a, b) => a - b);

test('a manager can add employees and managers; admins on the project stay; a stray admin is ignored, not refused', async () => {
  const mgr = { id: U.m, role: 'manager', name: 'm', pod: 'pod1' } as any;
  // what the old form sent: every admin, the existing team, plus the new people (and without the admin already on it)
  await updateProject(db(), mgr, U.P, { name: 'P', member_ids: [U.ad2, U.m, U.e, U.e2, U.m2] });
  assert.deepEqual(await members(), [U.ad, U.m, U.m2, U.e, U.e2].sort((a, b) => a - b));
  await updateProject(db(), mgr, U.P, { name: 'P', member_ids: [U.m, U.m2, U.e2] });
  assert.ok((await members()).includes(U.ad), 'the admin was not removed');
  assert.ok(!(await members()).includes(U.e), 'employees can be removed');
});
