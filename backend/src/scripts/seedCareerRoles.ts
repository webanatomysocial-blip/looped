/// <reference types="node" />
// One-off: the careers roles and their screening questions. Shows what it would do; changes nothing without --apply.
// Safe to run again: existing roles, questions and openings are reused, never duplicated.
//   node dist/scripts/seedCareerRoles.js           → dry run
//   node dist/scripts/seedCareerRoles.js --apply   → creates them
// Each role is a careers role (recruitment's own list, separate from Loop's employee departments; its own Question
// Bank tab) with a Draft job opening (nothing is published). The general
// "All roles" questions are turned off (not deleted) so each interview asks only the role's own questions.
import { initDB, getDB } from '../db';

const ROLES: { name: string; experience: string; type: string; questions: string[] }[] = [
  { name: 'Performance Marketer', experience: 'Below 2 years', type: 'Full-time', questions: [
    'What do you understand by digital advertising?', 'Which advertising platforms are you familiar with?',
    'What do you think helps a business grow?', 'Why is marketing important for a business?'] },
  { name: 'Graphic Designer', experience: 'Below 2 years', type: 'Full-time', questions: [
    'Which design tools are you familiar with?', 'What do you think makes a good design?',
    'What makes a brand stand out from its competitors?', 'Why is design important for a business?'] },
  { name: 'Account Manager', experience: 'Below 2 years', type: 'Full-time', questions: [
    'What do you understand about account management?', 'What do you think is important when managing clients?',
    'What do you think makes a business successful?', "Why is understanding a client's business important?"] },
  { name: 'SEO Intern', experience: 'Internship', type: 'Internship', questions: [
    'What do you understand by SEO?', 'Have you heard of keywords in SEO?',
    'How do businesses attract customers?', 'Why is having an online presence important for a business?'] },
  { name: 'Social Media Intern', experience: 'Internship', type: 'Internship', questions: [
    'Which social media platforms are you familiar with?', 'What do you think makes social media content interesting?',
    'Why do businesses need marketing?', 'How can social media help a business?'] },
  { name: 'Development Intern', experience: 'Internship', type: 'Internship', questions: [
    'Which programming languages are you familiar with?', 'What do you understand by web development?',
    'What do you think makes a business website effective?', 'Why is technology important for businesses today?'] },
  { name: "Founder's Office Intern", experience: 'Internship', type: 'Internship', questions: [
    "What do you understand by the Founder's Office role?", 'Are you comfortable working on tasks across different areas?',
    'What do you think are the key factors that help a business grow?', 'What do you think is the difference between working on a task and solving a business problem?'] },
  { name: 'Performance Marketing Intern', experience: 'Internship', type: 'Internship', questions: [
    'Have you heard of Google Ads or Meta Ads?', 'What do you understand by online advertising?',
    'Why do businesses promote their products or services?', 'What do you think helps a business attract potential customers?'] },
];
// 1–2 domain basics, 3–4 business basics (kept as the question's topic)
const TOPIC = ['Domain basics', 'Domain basics', 'Business basics', 'Business basics'];

async function main() {
  const apply = process.argv.includes('--apply');
  await initDB();
  const db = getDB();
  const say = (s: string) => console.log(`${apply ? '' : '[dry run] '}${s}`);
  const general = await db('rec_questions').whereNull('department_id').where({ active: true }).count({ n: '*' }).first().then((r: any) => Number(r.n));
  if (general) { say(`Turn off ${general} "All roles" question(s) (kept; can be turned back on in the Question Bank)`); if (apply) await db('rec_questions').whereNull('department_id').update({ active: false }); }
  for (const r of ROLES) {
    let dep = await db('rec_roles').whereRaw('LOWER(name) = ?', [r.name.toLowerCase()]).first('id');
    if (!dep) { say(`Create role "${r.name}"`); if (apply) { const [id] = await db('rec_roles').insert({ name: r.name }); dep = { id }; } }
    let added = 0;
    for (let i = 0; i < r.questions.length; i++) {
      const exists = dep && await db('rec_questions').where({ department_id: dep.id, text: r.questions[i] }).first('id');
      if (exists) continue;
      added++;
      if (apply) await db('rec_questions').insert({ department_id: dep!.id, category: TOPIC[i], text: r.questions[i], active: true });
    }
    say(`"${r.name}": ${added ? `add ${added} question(s)` : 'questions already there'}`);
    const job = await db('rec_jobs').whereRaw('LOWER(TRIM(title)) = ?', [r.name.toLowerCase()]).first('id');
    if (!job) {
      say(`  Draft opening "${r.name}" (${r.experience})`);
      if (apply) await db('rec_jobs').insert({ public_id: (await import('crypto')).randomUUID(), title: r.name, role_id: dep!.id, experience: r.experience, employment_type: r.type, vacancies: 1, status: 'draft' });
    }
  }
  console.log(apply ? '\nDone. Add descriptions to the Draft openings in Recruitment → Job Openings, then Publish.' : '\nDry run: nothing changed. Run again with --apply to create them.');
}
main().then(() => process.exit(0)).catch((e) => { console.error('Failed:', e?.message ?? e); process.exit(1); });
