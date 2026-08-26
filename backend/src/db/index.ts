import knex, { Knex } from 'knex';
import path from 'path';
import bcrypt from 'bcryptjs';

let db: Knex;

export function getDB(): Knex {
  return db;
}

export async function initDB(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    db = knex({
      client: 'mysql2',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        dateStrings: true,
      },
      pool: { min: 2, max: 10 },
    });
  } else {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: path.join(__dirname, '../../agency.db') },
      useNullAsDefault: true,
    });
  }

  await createSchema();
  await seedAdmin();
}

async function createSchema(): Promise<void> {
  // users
  await db.schema.hasTable('users').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('users', (t) => {
        t.increments('id').primary();
        t.string('name').notNullable();
        t.string('email').unique().notNullable();
        t.string('password_hash').notNullable();
        t.string('role').notNullable(); // admin | manager | employee | client
        t.string('avatar_color').defaultTo('#6366f1');
        t.integer('created_by').nullable();
        t.integer('client_company_id').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    } else {
      const hasCcId = await db.schema.hasColumn('users', 'client_company_id');
      if (!hasCcId) {
        await db.schema.table('users', (t) => {
          t.integer('client_company_id').nullable();
        });
      }
      const hasPod = await db.schema.hasColumn('users', 'pod');
      if (!hasPod) {
        await db.schema.table('users', (t) => {
          t.string('pod', 10).nullable();
        });
      }
      const hasSalary = await db.schema.hasColumn('users', 'monthly_salary');
      if (!hasSalary) {
        await db.schema.table('users', (t) => {
          t.decimal('monthly_salary', 12, 2).nullable();
        });
      }
    }
  });

  // employee categories master list
  await db.schema.hasTable('employee_categories').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('employee_categories', (t) => {
        t.increments('id').primary();
        t.string('name').notNullable().unique();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    }
  });

  // junction: which categories an employee belongs to
  await db.schema.hasTable('user_categories').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('user_categories', (t) => {
        t.increments('id').primary();
        t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.integer('category_id').notNullable().references('id').inTable('employee_categories').onDelete('CASCADE');
        t.unique(['user_id', 'category_id']);
      });
    }
  });

  // client companies
  await db.schema.hasTable('client_companies').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('client_companies', (t) => {
        t.increments('id').primary();
        t.string('name').notNullable();
        t.string('ga_property_id').nullable();   // GA4 Property ID e.g. "123456789"
        t.string('gsc_site_url').nullable();      // GSC site URL e.g. "https://example.com/"
        t.string('ads_customer_id').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    } else {
      // migrate existing tables
      const hasGa = await db.schema.hasColumn('client_companies', 'ga_property_id');
      if (!hasGa) {
        await db.schema.table('client_companies', (t) => {
          t.string('ga_property_id').nullable();
          t.string('gsc_site_url').nullable();
        });
      }
      const hasGbp = await db.schema.hasColumn('client_companies', 'gbp_location_id');
      if (!hasGbp) await db.schema.table('client_companies', (t) => t.string('gbp_location_id').nullable());
      const hasAdsCustId = await db.schema.hasColumn('client_companies', 'ads_customer_id');
      if (!hasAdsCustId) {
        await db.schema.table('client_companies', (t) => {
          t.string('ads_customer_id').nullable();
        });
      }
      const hasShareToken = await db.schema.hasColumn('client_companies', 'share_token');
      if (!hasShareToken) {
        await db.schema.table('client_companies', (t) => {
          t.string('share_token').nullable().unique();
          t.string('share_range').nullable();
          t.string('share_start').nullable();
          t.string('share_end').nullable();
        });
      }
      const hasShareDemographics = await db.schema.hasColumn('client_companies', 'share_demographics');
      if (!hasShareDemographics) {
        await db.schema.table('client_companies', (t) => {
          t.text('share_demographics').nullable(); // JSON array of selected city names
          t.text('share_acquisitions').nullable(); // JSON array of selected channel names
          t.string('share_country').nullable();
        });
      }
      const hasAdsShareToken = await db.schema.hasColumn('client_companies', 'ads_share_token');
      if (!hasAdsShareToken) {
        await db.schema.table('client_companies', (t) => {
          t.string('ads_share_token').nullable().unique();
          t.string('ads_share_start').nullable();
          t.string('ads_share_end').nullable();
        });
      }
    }
  });

  await db.schema.hasTable('ads_share_tokens').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('ads_share_tokens', (t) => {
        t.increments('id').primary();
        t.string('token').notNullable().unique();
        t.integer('client_id').notNullable().references('id').inTable('client_companies').onDelete('CASCADE');
        t.string('start_date').nullable();
        t.string('end_date').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    }
  });

  // multi-token share links for SEO
  await db.schema.hasTable('seo_share_tokens').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('seo_share_tokens', (t) => {
        t.increments('id').primary();
        t.string('token').notNullable().unique();
        t.integer('client_id').notNullable().references('id').inTable('client_companies').onDelete('CASCADE');
        t.string('range').nullable();
        t.string('start_date').nullable();
        t.string('end_date').nullable();
        t.string('compare_start').nullable();
        t.string('compare_end').nullable();
        t.text('demographics').nullable();
        t.text('acquisitions').nullable();
        t.string('country').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    } else {
      const hasCompareStart = await db.schema.hasColumn('seo_share_tokens', 'compare_start');
      if (!hasCompareStart) {
        await db.schema.table('seo_share_tokens', (t) => {
          t.string('compare_start').nullable();
          t.string('compare_end').nullable();
        });
      }
      const hasSnapshot = await db.schema.hasColumn('seo_share_tokens', 'manual_snapshot');
      if (!hasSnapshot) {
        await db.schema.table('seo_share_tokens', (t) => {
          t.text('manual_snapshot').nullable();
        });
      }
      const hasAgency = await db.schema.hasColumn('seo_share_tokens', 'agency_name');
      if (!hasAgency) await db.schema.table('seo_share_tokens', (t) => { t.string('agency_name').nullable(); });
    }
  });

  // seo manual data (keyword rankings, targets, gmb, linkedin, organic submissions, key achievements)
  await db.schema.hasTable('seo_manual_data').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('seo_manual_data', (t) => {
        t.increments('id').primary();
        t.integer('client_id').notNullable().references('id').inTable('client_companies').onDelete('CASCADE').unique();
        t.text('keyword_rankings').nullable();   // JSON: [{keyword, rank, change}]
        t.text('targets').nullable();            // JSON: [{name, target, achieved, unit}]
        t.text('key_achievements').nullable();   // JSON: [{title, value}]
        t.text('linkedin_data').nullable();      // JSON: rich linkedin metrics + posts
        t.text('social_media_data').nullable();  // JSON: instagram / facebook stats
        t.text('gmb_overview').nullable();
        t.integer('gmb_calls').nullable();
        t.integer('gmb_bookings').nullable();
        t.integer('gmb_website_clicks').nullable();
        t.text('organic_form_data').nullable();  // JSON: [{url, count}]
        t.integer('organic_submissions').defaultTo(0);
        t.decimal('gmb_rating', 3, 1).nullable();
        t.integer('gmb_reviews').nullable();
        t.string('gmb_profile_url').nullable();
        t.string('linkedin_url').nullable();
        t.integer('linkedin_followers').nullable();
        t.text('gmb_locations').nullable();
        t.text('executive_summary').nullable();
        t.text('sig_change_whys').nullable();
        t.text('last_period_plan').nullable();
        t.text('best_performing_asset').nullable();
        t.text('next_period_plan').nullable();
        t.text('period_targets').nullable();
        t.text('meta_organic').nullable();
        t.text('linkedin_organic').nullable();
        t.text('performance_marketing').nullable();
        t.integer('health_score').defaultTo(76);
        t.string('health_label').defaultTo('Weighted for a balanced goal, vs target');
        t.text('flags_risks').nullable();
        t.timestamp('updated_at').defaultTo(db.fn.now());
      });
    } else {
      const hasKa = await db.schema.hasColumn('seo_manual_data', 'key_achievements');
      if (!hasKa) {
        await db.schema.table('seo_manual_data', (t) => { t.text('key_achievements').nullable(); });
      }
      const hasLiData = await db.schema.hasColumn('seo_manual_data', 'linkedin_data');
      if (!hasLiData) await db.schema.table('seo_manual_data', (t) => { t.text('linkedin_data').nullable(); });
      const hasSocialMedia = await db.schema.hasColumn('seo_manual_data', 'social_media_data');
      if (!hasSocialMedia) await db.schema.table('seo_manual_data', (t) => { t.text('social_media_data').nullable(); });
      const hasGmbOverview = await db.schema.hasColumn('seo_manual_data', 'gmb_overview');
      if (!hasGmbOverview) await db.schema.table('seo_manual_data', (t) => {
        t.text('gmb_overview').nullable();
        t.integer('gmb_calls').nullable();
        t.integer('gmb_bookings').nullable();
        t.integer('gmb_website_clicks').nullable();
        t.text('organic_form_data').nullable();
      });
      const hasGmbLocations = await db.schema.hasColumn('seo_manual_data', 'gmb_locations');
      if (!hasGmbLocations) {
        await db.schema.table('seo_manual_data', (t) => {
          t.text('gmb_locations').nullable();
          t.text('executive_summary').nullable();
          t.text('sig_change_whys').nullable();
          t.text('last_period_plan').nullable();
          t.text('best_performing_asset').nullable();
          t.text('next_period_plan').nullable();
          t.text('period_targets').nullable();
        });
      }
      const hasMetaOrganic = await db.schema.hasColumn('seo_manual_data', 'meta_organic');
      if (!hasMetaOrganic) {
        await db.schema.table('seo_manual_data', (t) => {
          t.text('meta_organic').nullable();
          t.text('linkedin_organic').nullable();
          t.text('performance_marketing').nullable();
        });
      }
      const hasHealth = await db.schema.hasColumn('seo_manual_data', 'health_score');
      if (!hasHealth) {
        await db.schema.table('seo_manual_data', (t) => {
          t.integer('health_score').defaultTo(76);
          t.string('health_label').defaultTo('Weighted for a balanced goal, vs target');
        });
      }
      const hasFlagsRisks = await db.schema.hasColumn('seo_manual_data', 'flags_risks');
      if (!hasFlagsRisks) {
        await db.schema.table('seo_manual_data', (t) => { t.text('flags_risks').nullable(); });
      }
    }
  });

  // projects
  await db.schema.hasTable('projects').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('projects', (t) => {
        t.increments('id').primary();
        t.string('name').notNullable();
        t.integer('client_company_id').nullable().references('id').inTable('client_companies');
        t.string('status').defaultTo('active'); // active | in_review | on_hold | completed
        t.date('due_date').nullable();
        t.integer('created_by').notNullable().references('id').inTable('users');
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    }
  });

  // Migrate projects: billing/service fields
  const hasSvcType = await db.schema.hasColumn('projects', 'service_type');
  if (!hasSvcType) {
    await db.schema.table('projects', (t) => {
      t.string('service_type', 20).defaultTo('per_project'); // 'per_project' | 'xlr8'
      t.decimal('budget_amount', 12, 2).nullable();          // INR budget (both types)
      t.decimal('budgeted_hours', 8, 2).nullable();          // total hours (per_project) — legacy
      t.decimal('monthly_hours_bucket', 8, 2).nullable();    // monthly hour cap (xlr8)
      t.integer('billing_cycle_start_day').defaultTo(1);     // day of month cycle resets (xlr8)
    });
  }
  const hasCutoff = await db.schema.hasColumn('projects', 'budget_cutoff_pct');
  if (!hasCutoff) {
    await db.schema.table('projects', (t) => {
      t.decimal('budget_cutoff_pct', 5, 2).nullable();
    });
  }
  const hasPod = await db.schema.hasColumn('projects', 'pod');
  if (!hasPod) {
    await db.schema.table('projects', (t) => {
      t.string('pod', 10).nullable();                  // 'pod1' | 'pod2'
      t.text('briefing_doc').nullable();
      t.text('project_drive_doc').nullable();
      t.string('manager_status', 20).nullable();       // 'pending_manager' | 'accepted' | 'declined'
    });
  }
  const hasStartDate = await db.schema.hasColumn('projects', 'start_date');
  if (!hasStartDate) {
    await db.schema.table('projects', (t) => { t.date('start_date').nullable(); });
  }
  // project members
  await db.schema.hasTable('project_members').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('project_members', (t) => {
        t.increments('id').primary();
        t.integer('project_id').notNullable().references('id').inTable('projects');
        t.integer('user_id').notNullable().references('id').inTable('users');
        t.unique(['project_id', 'user_id']);
      });
    }
  });

  // Backfill client_company_id — runs after project_members exists
  try {
    const clientsWithoutCompany = await db('users')
      .where({ role: 'client' })
      .whereNull('client_company_id')
      .select('id');
    for (const u of clientsWithoutCompany) {
      const link = await db('project_members as pm')
        .join('projects as p', 'pm.project_id', 'p.id')
        .where('pm.user_id', u.id)
        .whereNotNull('p.client_company_id')
        .select('p.client_company_id')
        .first();
      if (link?.client_company_id) {
        await db('users').where({ id: u.id }).update({ client_company_id: link.client_company_id });
      }
    }
  } catch { /* table may not exist on first boot — safe to skip */ }

  // tasks
  await db.schema.hasTable('tasks').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('tasks', (t) => {
        t.increments('id').primary();
        t.string('title').notNullable();
        t.text('description').nullable();
        t.integer('project_id').notNullable().references('id').inTable('projects');
        t.integer('assigned_to').nullable().references('id').inTable('users');
        t.integer('created_by').notNullable().references('id').inTable('users');
        t.date('due_date').nullable();
        t.string('status').defaultTo('todo'); // todo | in_progress | in_review | overdue | completed
        t.integer('checklist_total').defaultTo(0);
        t.integer('checklist_done').defaultTo(0);
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    }
  });

  // task assignees (many-to-many: task ↔ users)
  await db.schema.hasTable('task_assignees').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('task_assignees', (t) => {
        t.integer('task_id').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
        t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.primary(['task_id', 'user_id']);
      });
    }
  });

  // task checklist items
  await db.schema.hasTable('task_checklist').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('task_checklist', (t) => {
        t.increments('id').primary();
        t.integer('task_id').notNullable().references('id').inTable('tasks');
        t.string('text').notNullable();
        t.boolean('completed').defaultTo(false);
      });
    }
  });

  // Migrate tasks: add estimated_hours
  const hasEstHours = await db.schema.hasColumn('tasks', 'estimated_hours');
  if (!hasEstHours) {
    await db.schema.table('tasks', (t) => { t.decimal('estimated_hours', 4, 2).nullable(); });
  }

  // Migrate tasks: add due_time (HH:MM string, e.g. "14:30")
  const hasDueTime = await db.schema.hasColumn('tasks', 'due_time');
  if (!hasDueTime) {
    await db.schema.table('tasks', (t) => { t.string('due_time', 5).nullable(); });
  }

  // Migrate task_assignees: add acceptance_status
  const hasAccStatus = await db.schema.hasColumn('task_assignees', 'acceptance_status');
  if (!hasAccStatus) {
    await db.schema.table('task_assignees', (t) => { t.string('acceptance_status').defaultTo('pending'); });
  }

  // Migrate task_assignees: add assignee_role (worker | alternate | manager)
  const hasAssigneeRole = await db.schema.hasColumn('task_assignees', 'assignee_role');
  if (!hasAssigneeRole) {
    await db.schema.table('task_assignees', (t) => { t.string('assignee_role').defaultTo('worker'); });
  }

  // Migrate task_assignees: add stage_idx for XLR8 pre-assignments
  const hasStageIdx = await db.schema.hasColumn('task_assignees', 'stage_idx');
  if (!hasStageIdx) {
    await db.schema.table('task_assignees', (t) => { t.integer('stage_idx').nullable(); });
  }

  // task_sessions — tracks timer start/pause/stop per task per user per day
  await db.schema.hasTable('task_sessions').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('task_sessions', (t) => {
        t.increments('id').primary();
        t.integer('task_id').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
        t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.datetime('started_at').notNullable();
        t.datetime('ended_at').nullable();
        t.date('session_date').notNullable();
      });
    }
  });

  // time_logs — one finalized row per timer session, the single aggregation source
  await db.schema.hasTable('time_logs').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('time_logs', (t) => {
        t.increments('id').primary();
        t.integer('task_id').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
        t.integer('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
        t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.integer('task_session_id').nullable().references('id').inTable('task_sessions').onDelete('SET NULL');
        t.date('log_date').notNullable();
        t.decimal('hours', 6, 2).notNullable();
        t.decimal('hourly_rate', 12, 6).nullable();
        t.text('notes').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    } else {
      const hasSessionId = await db.schema.hasColumn('time_logs', 'task_session_id');
      if (!hasSessionId) {
        await db.schema.table('time_logs', (t) => {
          t.integer('task_session_id').nullable();
        });
      }
      const hasHourlyRate = await db.schema.hasColumn('time_logs', 'hourly_rate');
      if (!hasHourlyRate) {
        await db.schema.table('time_logs', (t) => {
          t.decimal('hourly_rate', 12, 6).nullable(); // salary ÷ daysInMonth ÷ 7 at time of logging
        });
      }
    }
  });

  // Migrate task_assignees: rename 'worker' role → 'employee'
  try {
    const hasAssignees = await db.schema.hasTable('task_assignees');
    if (hasAssignees) {
      await db('task_assignees').where({ assignee_role: 'worker' }).update({ assignee_role: 'employee' });
    }
  } catch (e) { console.error('task_assignees worker→employee migration error:', e); }

  // Backfill time_logs from completed task_sessions that have no time_log yet.
  // Uses orphan-linking: if an unlinked time_log already matches (same task/user/date/hours),
  // update it to link the session rather than inserting a duplicate.
  try {
    const completedSessions = await db('task_sessions as ts')
      .join('tasks as t', 'ts.task_id', 't.id')
      .whereNotNull('ts.ended_at')
      .whereNotIn('ts.id', function () {
        this.select('task_session_id').from('time_logs').whereNotNull('task_session_id');
      })
      .select('ts.id as session_id', 'ts.task_id', 'ts.user_id', 'ts.started_at', 'ts.ended_at', 't.project_id');

    for (const s of completedSessions) {
      const startMs = Number(s.started_at);
      const endMs = Number(s.ended_at);
      const hours = Math.round((endMs - startMs) / 36000) / 100;
      if (hours < 0.01) continue;
      const logDate = new Date(startMs).toISOString().slice(0, 10);
      const userRec = await db('users').where({ id: s.user_id }).select('monthly_salary').first();
      const logDateObj = new Date(startMs);
      const daysInM = new Date(logDateObj.getFullYear(), logDateObj.getMonth() + 1, 0).getDate();
      const hourlyRate = userRec?.monthly_salary ? Number(userRec.monthly_salary) / daysInM / 7 : null;

      // Try to link an existing orphan log written before task_session_id column existed
      const orphan = await db('time_logs')
        .where({ task_id: s.task_id, user_id: s.user_id, log_date: logDate, hours })
        .whereNull('task_session_id')
        .first();

      if (orphan) {
        await db('time_logs').where({ id: orphan.id }).update({
          task_session_id: s.session_id,
          hourly_rate: orphan.hourly_rate ?? hourlyRate,
        });
      } else {
        await db('time_logs').insert({
          task_id: s.task_id,
          project_id: s.project_id,
          user_id: s.user_id,
          task_session_id: s.session_id,
          log_date: logDate,
          hours,
          hourly_rate: hourlyRate,
        });
      }
    }
  } catch (e) {
    console.error('time_logs backfill error:', e);
  }

  // Backfill hourly_rate on any existing time_logs where hourly_rate is NULL but user has monthly_salary
  try {
    const nullRateLogs = await db('time_logs as tl')
      .join('users as u', 'tl.user_id', 'u.id')
      .whereNull('tl.hourly_rate')
      .whereNotNull('u.monthly_salary')
      .select('tl.id', 'tl.log_date', 'u.monthly_salary');

    for (const log of nullRateLogs) {
      if (!log.monthly_salary) continue;
      const logD = log.log_date ? new Date(log.log_date) : new Date();
      const daysInM = new Date(logD.getFullYear(), logD.getMonth() + 1, 0).getDate();
      const rate = Number(log.monthly_salary) / daysInM / 7;
      await db('time_logs').where({ id: log.id }).update({ hourly_rate: rate });
    }
  } catch (e) {
    console.error('hourly_rate backfill error:', e);
  }

  // approvals
  await db.schema.hasTable('approvals').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('approvals', (t) => {
        t.increments('id').primary();
        t.integer('task_id').notNullable().references('id').inTable('tasks');
        t.string('title').notNullable();
        t.integer('project_id').notNullable().references('id').inTable('projects');
        t.integer('submitted_by').notNullable().references('id').inTable('users');
        // workflow_type: employee | manager | admin_with_client | admin_no_client
        t.string('workflow_type').nullable();
        t.string('status').defaultTo('pending_manager');
        // Legacy columns (kept for backward compat)
        t.integer('manager_approved_by').nullable();
        t.timestamp('manager_approved_at').nullable();
        t.text('manager_notes').nullable();
        t.integer('admin_approved_by').nullable();
        t.timestamp('admin_approved_at').nullable();
        t.text('admin_notes').nullable();
        t.timestamp('work_submitted_at').nullable();
        t.text('revision_notes').nullable();
        t.integer('final_approved_by').nullable();
        t.timestamp('final_approved_at').nullable();
        t.text('final_notes').nullable();
        t.integer('rejected_by').nullable();
        t.timestamp('rejected_at').nullable();
        t.text('rejection_notes').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    } else {
      const hasWfType = await db.schema.hasColumn('approvals', 'workflow_type');
      if (!hasWfType) {
        await db.schema.table('approvals', (t) => { t.string('workflow_type').nullable(); });
      }
    }
  });

  // approval_steps — full audit trail: one row per decision taken
  await db.schema.hasTable('approval_steps').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('approval_steps', (t) => {
        t.increments('id').primary();
        t.integer('approval_id').notNullable().references('id').inTable('approvals').onDelete('CASCADE');
        t.string('stage_key').notNullable();    // e.g. 'pending_manager'
        t.string('required_role').notNullable(); // 'manager' | 'admin' | 'client'
        t.string('action').notNullable();        // 'approve' | 'reject'
        t.integer('actor_id').nullable().references('id').inTable('users');
        t.string('actor_name').nullable();
        t.string('actor_role').nullable();
        t.text('comments').nullable();
        t.timestamp('acted_at').notNullable();
      });
    }
  });

  // assets
  await db.schema.hasTable('assets').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('assets', (t) => {
        t.increments('id').primary();
        t.string('name').notNullable();
        t.string('file_type').nullable();
        t.string('file_path').nullable();
        t.bigInteger('file_size').nullable();
        t.integer('project_id').nullable().references('id').inTable('projects');
        t.integer('uploaded_by').notNullable().references('id').inTable('users');
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    }
  });

  // notifications
  await db.schema.hasTable('notifications').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('notifications', (t) => {
        t.increments('id').primary();
        t.integer('user_id').notNullable().references('id').inTable('users');
        t.string('message').notNullable();
        t.string('type').defaultTo('info');
        t.boolean('read').defaultTo(false);
        t.integer('project_id').nullable().references('id').inTable('projects');
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    } else {
      const hasProjectId = await db.schema.hasColumn('notifications', 'project_id');
      if (!hasProjectId) {
        await db.schema.table('notifications', (t) => {
          t.integer('project_id').nullable().references('id').inTable('projects');
        });
      }
    }
  });

  // client-project messages (visible to clients)
  await db.schema.hasTable('messages').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('messages', (t) => {
        t.increments('id').primary();
        t.integer('sender_id').notNullable().references('id').inTable('users');
        t.integer('project_id').nullable().references('id').inTable('projects');
        t.text('message').notNullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    }
  });

  // internal chat rooms (direct 1:1 or group)
  await db.schema.hasTable('internal_chats').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('internal_chats', (t) => {
        t.increments('id').primary();
        t.string('type').notNullable(); // direct | group
        t.string('name').nullable();    // null for direct chats
        t.integer('created_by').notNullable().references('id').inTable('users');
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    }
  });

  // members of each internal chat room
  await db.schema.hasTable('internal_chat_members').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('internal_chat_members', (t) => {
        t.increments('id').primary();
        t.integer('chat_id').notNullable().references('id').inTable('internal_chats').onDelete('CASCADE');
        t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.unique(['chat_id', 'user_id']);
      });
    }
  });

  // internal chat messages
  await db.schema.hasTable('internal_messages').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('internal_messages', (t) => {
        t.increments('id').primary();
        t.integer('chat_id').notNullable().references('id').inTable('internal_chats').onDelete('CASCADE');
        t.integer('sender_id').notNullable().references('id').inTable('users');
        t.text('content').notNullable();
        t.string('file_url').nullable();
        t.string('file_name').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    }
  });

  // emails — for scheduled/sent mail via Gmail
  await db.schema.hasTable('emails').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('emails', (t) => {
        t.increments('id').primary();
        t.string('subject').notNullable();
        t.text('body').notNullable();
        t.string('status').defaultTo('scheduled'); // scheduled | sent | failed
        t.timestamp('scheduled_at').nullable();
        t.timestamp('sent_at').nullable();
        t.integer('created_by').nullable().references('id').inTable('users');
        t.text('error_message').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    }
  });

  // custom per-task approval flow (sequential list of approvers)
  await db.schema.hasTable('task_approval_flow').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('task_approval_flow', (t) => {
        t.increments('id').primary();
        t.integer('task_id').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
        t.integer('user_id').notNullable().references('id').inTable('users');
        t.integer('position').notNullable();
        t.unique(['task_id', 'position']);
      });
    }
  });

  // add current_step to approvals for custom workflow tracking
  await db.schema.hasTable('approvals').then(async (exists) => {
    if (exists) {
      const hasStep = await db.schema.hasColumn('approvals', 'current_step');
      if (!hasStep) {
        await db.schema.table('approvals', (t) => {
          t.integer('current_step').defaultTo(0);
        });
      }
    }
  });

  // notification preferences
  await db.schema.hasTable('notification_preferences').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('notification_preferences', (t) => {
        t.increments('id').primary();
        t.integer('user_id').notNullable().references('id').inTable('users');
        t.integer('client_user_id').nullable().references('id').inTable('users');
        t.string('pref_key', 50).notNullable(); // 'approvals' | 'responses' | 'comments'
        t.boolean('enabled').notNullable().defaultTo(true);
        t.unique(['user_id', 'client_user_id', 'pref_key']);
      });
    }
  });

  // email recipients — snapshot of email + name at send time
  await db.schema.hasTable('email_recipients').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('email_recipients', (t) => {
        t.increments('id').primary();
        t.integer('email_id').notNullable().references('id').inTable('emails');
        t.integer('user_id').nullable().references('id').inTable('users');
        t.string('email').notNullable();
        t.string('name').notNullable();
      });
    }
  });

  await db.schema.hasTable('ads_manual_data').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('ads_manual_data', (t) => {
        t.increments('id').primary();
        t.integer('client_id').notNullable().references('id').inTable('client_companies');
        t.text('notes').nullable();
        t.text('campaigns_manual').nullable();
        t.timestamp('updated_at').defaultTo(db.fn.now());
      });
    }
  });

  // contact-forms: embeddable per-site contact forms (migrated from standalone contactform app)
  await db.schema.hasTable('contact_projects').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('contact_projects', (t) => {
        t.increments('id').primary();
        t.string('name').notNullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    }
  });

  await db.schema.hasTable('contact_forms').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('contact_forms', (t) => {
        t.increments('id').primary();
        t.string('name').notNullable();
        t.text('fields').notNullable().defaultTo('[]');
        t.string('to_emails').notNullable().defaultTo('');
        t.text('template').notNullable().defaultTo('');
        t.integer('contact_project_id').nullable();
        t.integer('client_id').nullable().references('id').inTable('client_companies').onDelete('CASCADE');
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    } else {
      const hasCid = await db.schema.hasColumn('contact_forms', 'client_id');
      if (!hasCid) await db.schema.table('contact_forms', (t) => { t.integer('client_id').nullable(); });
      const hasRedirect = await db.schema.hasColumn('contact_forms', 'redirect_url');
      if (!hasRedirect) await db.schema.table('contact_forms', (t) => { t.text('redirect_url').nullable(); });
      const hasOtp = await db.schema.hasColumn('contact_forms', 'otp_enabled');
      if (!hasOtp) await db.schema.table('contact_forms', (t) => { t.boolean('otp_enabled').notNullable().defaultTo(false); });
      const hasStyleConfig = await db.schema.hasColumn('contact_forms', 'style_config');
      if (!hasStyleConfig) await db.schema.table('contact_forms', (t) => { t.text('style_config').nullable(); });
      const hasWebhook = await db.schema.hasColumn('contact_forms', 'webhook_url');
      if (!hasWebhook) await db.schema.table('contact_forms', (t) => { t.text('webhook_url').nullable(); });
      const hasConfirmField = await db.schema.hasColumn('contact_forms', 'confirmation_email_field');
      if (!hasConfirmField) await db.schema.table('contact_forms', (t) => { t.string('confirmation_email_field').nullable(); });
      const hasConfirmMsg = await db.schema.hasColumn('contact_forms', 'confirmation_message');
      if (!hasConfirmMsg) await db.schema.table('contact_forms', (t) => { t.text('confirmation_message').nullable(); });
      const hasConfirmAttach = await db.schema.hasColumn('contact_forms', 'confirmation_attachment');
      if (!hasConfirmAttach) await db.schema.table('contact_forms', (t) => { t.string('confirmation_attachment').nullable(); });
      const hasConditions = await db.schema.hasColumn('contact_forms', 'conditions');
      if (!hasConditions) await db.schema.table('contact_forms', (t) => { t.text('conditions').nullable(); });
      // Fix non-nullable columns in MySQL from older deployments
      if (process.env.NODE_ENV === 'production') {
        const hasContactProjCol = await db.schema.hasColumn('contact_forms', 'contact_project_id');
        if (hasContactProjCol) await db.raw('ALTER TABLE `contact_forms` MODIFY `contact_project_id` INT NULL');
        const hasTemplate = await db.schema.hasColumn('contact_forms', 'template');
        if (hasTemplate) await db.raw("ALTER TABLE `contact_forms` MODIFY `template` TEXT NULL DEFAULT NULL");
        else await db.schema.table('contact_forms', (t) => { t.text('template').nullable(); });
      }
    }
  });

  await db.schema.hasTable('contact_submissions').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('contact_submissions', (t) => {
        t.increments('id').primary();
        t.text('data').notNullable();
        t.string('form_name').notNullable();
        t.integer('contact_project_id').nullable();
        t.integer('client_id').nullable();
        t.integer('contact_form_id').nullable().references('id').inTable('contact_forms').onDelete('SET NULL');
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    } else {
      const hasCid = await db.schema.hasColumn('contact_submissions', 'client_id');
      if (!hasCid) await db.schema.table('contact_submissions', (t) => { t.integer('client_id').nullable(); });
      const hasRead = await db.schema.hasColumn('contact_submissions', 'read');
      if (!hasRead) await db.schema.table('contact_submissions', (t) => { t.boolean('read').notNullable().defaultTo(false); });
      const hasFiles = await db.schema.hasColumn('contact_submissions', 'files');
      if (!hasFiles) await db.schema.table('contact_submissions', (t) => { t.text('files').nullable(); });
      if (process.env.NODE_ENV === 'production') {
        const hasContactProjCol = await db.schema.hasColumn('contact_submissions', 'contact_project_id');
        if (hasContactProjCol) await db.raw('ALTER TABLE `contact_submissions` MODIFY `contact_project_id` INT NULL');
      }
    }

    // Backfill client_id from contact_project_id via matching name in client_companies
    const hasProjectsTable = await db.schema.hasTable('contact_projects');
    if (hasProjectsTable) {
      await db.raw(`
        UPDATE contact_forms
        SET client_id = (
          SELECT cc.id FROM client_companies cc
          INNER JOIN contact_projects cp ON LOWER(cp.name) = LOWER(cc.name)
          WHERE cp.id = contact_forms.contact_project_id
        )
        WHERE client_id IS NULL AND contact_project_id IS NOT NULL
      `);
      await db.raw(`
        UPDATE contact_submissions
        SET client_id = (SELECT client_id FROM contact_forms WHERE contact_forms.id = contact_submissions.contact_form_id)
        WHERE client_id IS NULL
      `);
    }
  });

  // SEO saved reports
  await db.schema.hasTable('seo_saved_reports').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('seo_saved_reports', (t) => {
        t.increments('id').primary();
        t.integer('client_id').notNullable().references('id').inTable('client_companies').onDelete('CASCADE');
        t.integer('created_by').notNullable().references('id').inTable('users');
        t.string('name').notNullable();
        t.string('range').notNullable();
        t.string('start_date').nullable();
        t.string('end_date').nullable();
        t.string('compare_start').nullable();
        t.string('compare_end').nullable();
        t.string('country').nullable();
        t.string('share_token').nullable();
        t.text('manual_snapshot').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    } else {
      const hasShareToken = await db.schema.hasColumn('seo_saved_reports', 'share_token');
      if (!hasShareToken) await db.schema.table('seo_saved_reports', (t) => t.string('share_token').nullable());
      const hasManualSnapshot = await db.schema.hasColumn('seo_saved_reports', 'manual_snapshot');
      if (!hasManualSnapshot) await db.schema.table('seo_saved_reports', (t) => t.text('manual_snapshot').nullable());
      const hasAgencyName = await db.schema.hasColumn('seo_saved_reports', 'agency_name');
      if (!hasAgencyName) await db.schema.table('seo_saved_reports', (t) => t.string('agency_name').nullable());
    }
  });

  // Local SEO rank tracking
  await db.schema.hasTable('local_seo_configs').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('local_seo_configs', (t) => {
        t.increments('id').primary();
        t.integer('client_company_id').notNullable().unique();
        t.string('domain').notNullable().defaultTo('');
        t.string('address').notNullable().defaultTo('');
        t.text('keywords').notNullable().defaultTo('[]');
        t.text('locations').notNullable().defaultTo('[]');
        t.string('country_code', 5).notNullable().defaultTo('in');
        t.float('radius_km').notNullable().defaultTo(10);
        t.integer('grid_size').notNullable().defaultTo(7);
        t.timestamp('updated_at').defaultTo(db.fn.now());
      });
    } else {
      // add new columns to existing table if missing
      const hasAddress = await db.schema.hasColumn('local_seo_configs', 'address');
      if (!hasAddress) await db.schema.table('local_seo_configs', (t) => t.string('address').notNullable().defaultTo(''));
      const hasRadius = await db.schema.hasColumn('local_seo_configs', 'radius_km');
      if (!hasRadius) await db.schema.table('local_seo_configs', (t) => t.float('radius_km').notNullable().defaultTo(10));
      const hasGrid = await db.schema.hasColumn('local_seo_configs', 'grid_size');
      if (!hasGrid) await db.schema.table('local_seo_configs', (t) => t.integer('grid_size').notNullable().defaultTo(7));
    }
  });

  await db.schema.hasTable('local_seo_results').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('local_seo_results', (t) => {
        t.increments('id').primary();
        t.integer('client_company_id').notNullable();
        t.string('keyword').notNullable();
        t.string('location').notNullable();
        t.integer('position').nullable();
        t.string('result_url', 1000).nullable();
        t.string('result_title', 500).nullable();
        t.string('checked_at').notNullable();
      });
    }
  });

  // Geogrid results (map-based rank tracking)
  await db.schema.hasTable('geo_grid_results').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('geo_grid_results', (t) => {
        t.increments('id').primary();
        t.integer('client_company_id').notNullable();
        t.string('keyword').notNullable();
        t.float('center_lat').notNullable();
        t.float('center_lng').notNullable();
        t.float('radius_km').notNullable();
        t.integer('grid_size').notNullable();
        t.text('results').notNullable(); // JSON array
        t.string('checked_at').notNullable();
      });
    }
  });

  // App settings key-value store
  await db.schema.hasTable('app_settings').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('app_settings', (t) => {
        t.string('key').primary();
        t.text('value').nullable();
        t.timestamps(true, true);
      });
    }
  });

  // ── XLR8 Ticket Workflow ────────────────────────────────────────────────────

  // Ticket types — admin-managed, each has a JSON stage chain
  await db.schema.hasTable('xlr8_ticket_types').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('xlr8_ticket_types', (t) => {
        t.increments('id').primary();
        t.string('name').notNullable();
        // stages: JSON array of { category_id, category_name }
        t.text('stages').defaultTo('[]');
        // final_approval: JSON { adminRequired, adminSkippable, clientOptional }
        t.text('final_approval').defaultTo('{"adminRequired":true,"adminSkippable":true,"clientOptional":true}');
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    } else {
      const hasChecklist = await db.schema.hasColumn('xlr8_ticket_types', 'checklist');
      if (!hasChecklist) await db.schema.table('xlr8_ticket_types', t => { t.text('checklist').defaultTo('[]'); });
    }
  });

  // Ticket audit log — append-only, one row per state transition
  await db.schema.hasTable('xlr8_ticket_log').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('xlr8_ticket_log', (t) => {
        t.increments('id').primary();
        t.integer('task_id').notNullable().references('id').inTable('tasks').onDelete('CASCADE');
        t.integer('actor_id').nullable().references('id').inTable('users');
        t.string('actor_name').nullable();
        t.string('action').notNullable();       // 'created' | 'sent_to_manager' | 'manager_accepted' | 'manager_declined' | 'assigned' | 'work_done' | 'manager_approved' | 'sent_to_admin' | 'admin_skipped' | 'admin_approved' | 'sent_to_client' | 'client_approved' | 'completed'
        t.string('from_state').nullable();
        t.string('to_state').nullable();
        t.text('comment').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    }
  });

  // Migrate tasks: add XLR8 ticket columns
  const hasTicketTypeId  = await db.schema.hasColumn('tasks', 'ticket_type_id');
  const hasXlr8StageIdx  = await db.schema.hasColumn('tasks', 'xlr8_stage_idx');
  const hasXlr8Status    = await db.schema.hasColumn('tasks', 'xlr8_status');
  const hasXlr8AssigneeId = await db.schema.hasColumn('tasks', 'xlr8_assignee_id');
  await db.schema.table('tasks', (t) => {
    if (!hasTicketTypeId)   t.integer('ticket_type_id').nullable();
    if (!hasXlr8StageIdx)   t.integer('xlr8_stage_idx').nullable();   // which stage we're on (0-based)
    if (!hasXlr8Status)     t.string('xlr8_status').nullable();       // pending_manager | pending_assignee | pending_admin | pending_client | completed
    if (!hasXlr8AssigneeId) t.integer('xlr8_assignee_id').nullable(); // current stage assignee
  });

  // Add file_url / file_name to messages table for client chat attachments
  const hasMsgFileUrl = await db.schema.hasColumn('messages', 'file_url');
  if (!hasMsgFileUrl) {
    await db.schema.table('messages', (t) => {
      t.string('file_url').nullable();
      t.string('file_name').nullable();
    });
  }

  // recurring_tasks
  await db.schema.hasTable('recurring_tasks').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('recurring_tasks', (t) => {
        t.increments('id').primary();
        t.string('title').notNullable();
        t.text('description').nullable();
        t.integer('assigned_to').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.integer('created_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.integer('project_id').nullable().references('id').inTable('projects').onDelete('SET NULL');
        t.string('recurrence_type').notNullable(); // daily | weekly | monthly
        t.text('recurrence_days').nullable();       // JSON: [1,3,5] for Mon/Wed/Fri (0=Sun)
        t.integer('day_of_month').nullable();       // for monthly
        t.string('start_date').notNullable();       // YYYY-MM-DD
        t.string('end_date').nullable();            // YYYY-MM-DD or null = no end
        t.float('estimated_hours').defaultTo(1);
        t.string('priority').defaultTo('medium');
        t.boolean('active').defaultTo(true);
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
    }
  });

  // Add recurring_task_id to tasks
  const hasRecurringTaskId = await db.schema.hasColumn('tasks', 'recurring_task_id');
  if (!hasRecurringTaskId) {
    await db.schema.table('tasks', (t) => {
      t.integer('recurring_task_id').nullable().references('id').inTable('recurring_tasks').onDelete('SET NULL');
      t.string('recurrence_date').nullable(); // YYYY-MM-DD the instance is for
    });
  }

  const hasPriority = await db.schema.hasColumn('tasks', 'priority');
  if (!hasPriority) {
    await db.schema.table('tasks', (t) => { t.string('priority').defaultTo('medium'); });
  }
}

async function seedAdmin(): Promise<void> {
  // Seed default employee categories (always, in all environments)
  const defaultCategories = [
    'Web Developer', 'UI/UX Designer', 'Social Media Manager',
    'Ads Specialist', 'Sales Executive', 'SEO Specialist', 'Graphic Designer',
  ];
  for (const name of defaultCategories) {
    const exists = await db('employee_categories').where({ name }).first();
    if (!exists) await db('employee_categories').insert({ name });
  }

  // In production, create the first admin from env vars if no users exist yet
  if (process.env.NODE_ENV === 'production') {
    const anyUser = await db('users').first();
    if (!anyUser && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await db('users').insert({
        name: process.env.ADMIN_NAME || 'Admin',
        email: process.env.ADMIN_EMAIL,
        password_hash: hash,
        role: 'admin',
        avatar_color: '#6366f1',
      });
      console.log(`Production admin created: ${process.env.ADMIN_EMAIL}`);
    }
    return;
  }

  // Only seed demo users if the table is completely empty (first run only)
  const anyUser = await db('users').first();
  if (anyUser) return;

  const demoUsers = [
    { name: 'Admin User',    email: 'admin@agency.com',    password: 'Admin@123',    role: 'admin',    avatar_color: '#E8424A' },
    { name: 'Sara Manager',  email: 'manager@agency.com',  password: 'Manager@123',  role: 'manager',  avatar_color: '#F47326' },
    { name: 'Alex Employee', email: 'employee@agency.com', password: 'Employee@123', role: 'employee', avatar_color: '#4A90E2' },
    { name: 'Client Corp',   email: 'client@agency.com',   password: 'Client@123',   role: 'client',   avatar_color: '#4caf7d' },
  ];

  for (const u of demoUsers) {
    const hash = await bcrypt.hash(u.password, 10);
    await db('users').insert({
      name: u.name, email: u.email,
      password_hash: hash, role: u.role, avatar_color: u.avatar_color,
    });
    console.log(`Demo user created: ${u.email} / ${u.password}`);
  }
}

export async function createNotification(userId: number, message: string, type = 'info', projectId?: number | null): Promise<void> {
  await db('notifications').insert({ user_id: userId, message, type, ...(projectId ? { project_id: projectId } : {}) });
}

// Returns false if the recipient has disabled this pref key for any client in the project
export async function isNotifEnabled(
  recipientId: number,
  projectId: number,
  prefKey: 'approvals' | 'responses' | 'comments'
): Promise<boolean> {
  const project = await db('projects').where({ id: projectId }).select('client_company_id').first();
  const clients = project?.client_company_id
    ? await db('users').where({ role: 'client', client_company_id: project.client_company_id }).select('id as client_user_id')
    : await db('project_members as pm').join('users as u', 'pm.user_id', 'u.id')
        .where('pm.project_id', projectId).where('u.role', 'client').select('u.id as client_user_id');

  for (const c of clients) {
    const pref = await db('notification_preferences')
      .where({ user_id: recipientId, client_user_id: c.client_user_id, pref_key: prefKey })
      .first();
    if (pref && !pref.enabled) return false;
  }
  return true;
}
