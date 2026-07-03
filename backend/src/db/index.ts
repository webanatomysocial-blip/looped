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
        t.timestamp('updated_at').defaultTo(db.fn.now());
      });
    } else {
      const hasKa = await db.schema.hasColumn('seo_manual_data', 'key_achievements');
      if (!hasKa) {
        await db.schema.table('seo_manual_data', (t) => { t.text('key_achievements').nullable(); });
      }
      const hasLiData = await db.schema.hasColumn('seo_manual_data', 'linkedin_data');
      if (!hasLiData) await db.schema.table('seo_manual_data', (t) => { t.text('linkedin_data').nullable(); });
      const hasGmbOverview = await db.schema.hasColumn('seo_manual_data', 'gmb_overview');
      if (!hasGmbOverview) await db.schema.table('seo_manual_data', (t) => {
        t.text('gmb_overview').nullable();
        t.integer('gmb_calls').nullable();
        t.integer('gmb_bookings').nullable();
        t.integer('gmb_website_clicks').nullable();
        t.text('organic_form_data').nullable();
      });
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

  // approvals — status uses string so workflow can evolve without schema changes
  // Statuses: pending_manager → pending_admin → pending_client → work_in_progress → pending_review → approved | revision_requested | rejected
  await db.schema.hasTable('approvals').then(async (exists) => {
    if (!exists) {
      await db.schema.createTable('approvals', (t) => {
        t.increments('id').primary();
        t.integer('task_id').notNullable().references('id').inTable('tasks');
        t.string('title').notNullable();
        t.integer('project_id').notNullable().references('id').inTable('projects');
        t.integer('submitted_by').notNullable().references('id').inTable('users');
        t.string('status').defaultTo('pending_manager');
        // Manager review
        t.integer('manager_approved_by').nullable();
        t.timestamp('manager_approved_at').nullable();
        t.text('manager_notes').nullable();
        // Admin review
        t.integer('admin_approved_by').nullable();
        t.timestamp('admin_approved_at').nullable();
        t.text('admin_notes').nullable();
        // Completion review (after employee marks task complete)
        t.timestamp('work_submitted_at').nullable();
        t.text('revision_notes').nullable();
        // Final approval by manager/admin/client
        t.integer('final_approved_by').nullable();
        t.timestamp('final_approved_at').nullable();
        t.text('final_notes').nullable();
        // Rejection
        t.integer('rejected_by').nullable();
        t.timestamp('rejected_at').nullable();
        t.text('rejection_notes').nullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
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
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
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
}

async function seedAdmin(): Promise<void> {
  // Seed default employee categories (always, in all environments)
  const defaultCategories = [
    'Web Developer', 'UI/UX Designer', 'Social Media Manager',
    'Ads Specialist', 'Sales Executive', 'SEO Specialist',
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

  const demoUsers = [
    { name: 'Admin User',    email: 'admin@agency.com',    password: 'Admin@123',    role: 'admin',    avatar_color: '#E8424A' },
    { name: 'Sara Manager',  email: 'manager@agency.com',  password: 'Manager@123',  role: 'manager',  avatar_color: '#F47326' },
    { name: 'Alex Employee', email: 'employee@agency.com', password: 'Employee@123', role: 'employee', avatar_color: '#4A90E2' },
    { name: 'Client Corp',   email: 'client@agency.com',   password: 'Client@123',   role: 'client',   avatar_color: '#4caf7d' },
  ];

  for (const u of demoUsers) {
    const existing = await db('users').where({ email: u.email }).first();
    if (!existing) {
      const hash = await bcrypt.hash(u.password, 10);
      await db('users').insert({
        name: u.name, email: u.email,
        password_hash: hash, role: u.role, avatar_color: u.avatar_color,
      });
      console.log(`Demo user created: ${u.email} / ${u.password}`);
    }
  }
}

export async function createNotification(userId: number, message: string, type = 'info'): Promise<void> {
  await db('notifications').insert({ user_id: userId, message, type });
}
