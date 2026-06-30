"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDB = getDB;
exports.initDB = initDB;
exports.createNotification = createNotification;
const knex_1 = __importDefault(require("knex"));
const path_1 = __importDefault(require("path"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
let db;
function getDB() {
    return db;
}
async function initDB() {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
        db = (0, knex_1.default)({
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
    }
    else {
        db = (0, knex_1.default)({
            client: 'better-sqlite3',
            connection: { filename: path_1.default.join(__dirname, '../../agency.db') },
            useNullAsDefault: true,
        });
    }
    await createSchema();
    await seedAdmin();
}
async function createSchema() {
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
                t.timestamp('created_at').defaultTo(db.fn.now());
            });
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
                t.timestamp('created_at').defaultTo(db.fn.now());
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
                t.string('name').nullable(); // null for direct chats
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
}
async function seedAdmin() {
    // Seed default employee categories
    const defaultCategories = [
        'Web Developer', 'UI/UX Designer', 'Social Media Manager',
        'Ads Specialist', 'Sales Executive', 'SEO Specialist',
    ];
    for (const name of defaultCategories) {
        const exists = await db('employee_categories').where({ name }).first();
        if (!exists)
            await db('employee_categories').insert({ name });
    }
    // Seed demo users
    const demoUsers = [
        { name: 'Admin User', email: 'admin@agency.com', password: 'Admin@123', role: 'admin', avatar_color: '#E8424A' },
        { name: 'Sara Manager', email: 'manager@agency.com', password: 'Manager@123', role: 'manager', avatar_color: '#F47326' },
        { name: 'Alex Employee', email: 'employee@agency.com', password: 'Employee@123', role: 'employee', avatar_color: '#4A90E2' },
        { name: 'Client Corp', email: 'client@agency.com', password: 'Client@123', role: 'client', avatar_color: '#4caf7d' },
    ];
    for (const u of demoUsers) {
        const existing = await db('users').where({ email: u.email }).first();
        if (!existing) {
            const hash = await bcryptjs_1.default.hash(u.password, 10);
            await db('users').insert({
                name: u.name, email: u.email,
                password_hash: hash, role: u.role, avatar_color: u.avatar_color,
            });
            console.log(`Demo user created: ${u.email} / ${u.password}`);
        }
    }
}
async function createNotification(userId, message, type = 'info') {
    await db('notifications').insert({ user_id: userId, message, type });
}
