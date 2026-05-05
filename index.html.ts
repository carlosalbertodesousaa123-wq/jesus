
// ============================================================
// FitManager Pro — Backend Starter Kit
// Node.js + Express + TypeScript + Knex + PostgreSQL
// ============================================================

// ── package.json ──────────────────────────────────────────
const packageJson = {
  "name": "@fitmanager/api",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "migrate": "knex migrate:latest",
    "rollback": "knex migrate:rollback"
  },
  "dependencies": {
    "express": "^4.18.2",
    "knex": "^3.1.0",
    "pg": "^8.11.3",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "mercadopago": "^1.5.14",
    "@sendgrid/mail": "^8.1.1",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "body-parser": "^1.20.2",
    "node-cron": "^3.0.3",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "tsx": "^4.6.2",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/cors": "^2.8.17"
  }
};

// ── db/migrations/001_initial.ts ──────────────────────────
export async function up(knex: any) {
  await knex.schema

    .createTable('trainers', (t: any) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.string('name', 120).notNullable();
      t.string('email', 120).unique().notNullable();
      t.text('password_hash').notNullable();
      t.string('phone', 20);
      t.text('logo_url');
      t.string('plan', 20).defaultTo('trial');
      t.timestamp('plan_expires');
      t.text('mp_customer_id');
      t.boolean('is_active').defaultTo(true);
      t.timestamps(true, true);
    })

    .createTable('students', (t: any) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('trainer_id').references('id').inTable('trainers').onDelete('CASCADE');
      t.string('name', 120).notNullable();
      t.string('email', 120);
      t.string('phone', 20);
      t.date('birth_date');
      t.text('goal');
      t.decimal('monthly_fee', 10, 2).defaultTo(0);
      t.integer('billing_day').defaultTo(5);
      t.boolean('is_active').defaultTo(true);
      t.boolean('is_blocked').defaultTo(false);
      t.text('access_token').unique();
      t.text('mp_sub_id');
      t.timestamps(true, true);
    })

    .createTable('workouts', (t: any) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('student_id').references('id').inTable('students').onDelete('CASCADE');
      t.uuid('trainer_id').references('id').inTable('trainers');
      t.string('name', 100).notNullable();
      t.integer('day_of_week').notNullable(); // 0-6
      t.boolean('is_active').defaultTo(true);
      t.timestamps(true, true);
    })

    .createTable('workout_exercises', (t: any) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('workout_id').references('id').inTable('workouts').onDelete('CASCADE');
      t.string('name', 100).notNullable();
      t.integer('sets').notNullable();
      t.string('reps', 20).notNullable();
      t.decimal('load_kg', 6, 2);
      t.integer('rest_seconds').defaultTo(60);
      t.text('notes');
      t.text('video_url');
      t.integer('order_index').defaultTo(0);
      t.timestamps(true, true);
    })

    .createTable('training_sessions', (t: any) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('student_id').references('id').inTable('students').onDelete('CASCADE');
      t.uuid('workout_id').references('id').inTable('workouts');
      t.timestamp('started_at').defaultTo(knex.fn.now());
      t.timestamp('finished_at');
      t.integer('completion').defaultTo(0);
    })

    .createTable('exercise_logs', (t: any) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('session_id').references('id').inTable('training_sessions').onDelete('CASCADE');
      t.uuid('workout_exercise_id').references('id').inTable('workout_exercises');
      t.uuid('student_id').references('id').inTable('students');
      t.decimal('load_used_kg', 6, 2);
      t.integer('sets_done');
      t.string('reps_done', 20);
      t.boolean('completed').defaultTo(false);
      t.text('notes');
      t.timestamp('logged_at').defaultTo(knex.fn.now());
    })

    .createTable('body_metrics', (t: any) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('student_id').references('id').inTable('students').onDelete('CASCADE');
      t.decimal('weight_kg', 5, 2);
      t.decimal('body_fat', 4, 2);
      t.decimal('muscle_mass', 5, 2);
      t.text('notes');
      t.date('measured_at').notNullable();
      t.timestamps(true, true);
    })

    .createTable('payments', (t: any) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('student_id').references('id').inTable('students');
      t.uuid('trainer_id').references('id').inTable('trainers');
      t.decimal('amount', 10, 2).notNullable();
      t.date('due_date').notNullable();
      t.timestamp('paid_at');
      t.string('status', 20).defaultTo('pending'); // pending|paid|overdue|cancelled
      t.string('payment_method', 20);
      t.text('mp_payment_id');
      t.timestamps(true, true);
    });
}

export async function down(knex: any) {
  await knex.schema
    .dropTableIfExists('payments')
    .dropTableIfExists('body_metrics')
    .dropTableIfExists('exercise_logs')
    .dropTableIfExists('training_sessions')
    .dropTableIfExists('workout_exercises')
    .dropTableIfExists('workouts')
    .dropTableIfExists('students')
    .dropTableIfExists('trainers');
}

// ── jobs/billingCron.ts ───────────────────────────────────
import cron from 'node-cron';

// Roda todo dia às 09:00
export function startBillingJob(db: any) {
  cron.schedule('0 9 * * *', async () => {
    console.log('💳 Verificando cobranças...');
    const today = new Date().getDate();

    // Busca alunos com cobrança vencendo hoje
    const students = await db('students')
      .where({ billing_day: today, is_active: true })
      .whereNull('mp_sub_id'); // manual billing only

    for (const student of students) {
      await db('payments').insert({
        student_id: student.id,
        trainer_id: student.trainer_id,
        amount: student.monthly_fee,
        due_date: new Date(),
        status: 'pending',
      });
      console.log(`📬 Cobrança criada para ${student.name}`);
    }

    // Bloqueia quem está há 3+ dias atrasado
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const overdue = await db('payments')
      .where({ status: 'pending' })
      .where('due_date', '<=', threeDaysAgo)
      .select('student_id');

    if (overdue.length) {
      await db('students')
        .whereIn('id', overdue.map((p: any) => p.student_id))
        .update({ is_blocked: true });

      console.log(`🔒 ${overdue.length} alunos bloqueados por inadimplência`);
    }
  });
}

// ── routes/auth.ts ────────────────────────────────────────
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export function createAuthRouter(db: any) {
  const router = Router();

  // Register trainer
  router.post('/register', async (req: Request, res: Response) => {
    const { name, email, password, phone } = req.body;

    const exists = await db('trainers').where({ email }).first();
    if (exists) return res.status(400).json({ error: 'E-mail já cadastrado' });

    const password_hash = await bcrypt.hash(password, 12);
    const plan_expires = new Date();
    plan_expires.setDate(plan_expires.getDate() + 7); // 7 dias trial

    const [trainer] = await db('trainers')
      .insert({ name, email, password_hash, phone, plan: 'trial', plan_expires })
      .returning(['id', 'name', 'email', 'plan', 'plan_expires']);

    const token = jwt.sign(
      { id: trainer.id, role: 'trainer' },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.status(201).json({ trainer, token });
  });

  // Login trainer
  router.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body;

    const trainer = await db('trainers').where({ email }).first();
    if (!trainer) return res.status(401).json({ error: 'Credenciais inválidas' });

    const valid = await bcrypt.compare(password, trainer.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

    const token = jwt.sign(
      { id: trainer.id, role: 'trainer' },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    const { password_hash, ...trainerData } = trainer;
    res.json({ trainer: trainerData, token });
  });

  // Login aluno via token único
  router.get('/student/:token', async (req: Request, res: Response) => {
    const student = await db('students')
      .where({ access_token: req.params.token, is_active: true })
      .first();

    if (!student) return res.status(404).json({ error: 'Link inválido' });
    if (student.is_blocked) return res.status(403).json({ error: 'Acesso bloqueado. Verifique seu pagamento.' });

    const token = jwt.sign(
      { id: student.id, role: 'student' },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' }
    );

    const { access_token, ...studentData } = student;
    res.json({ student: studentData, token });
  });

  return router;
}

// ── routes/metrics.ts ─────────────────────────────────────
export function createMetricsRouter(db: any) {
  const router = Router();

  router.get('/dashboard', async (req: any, res: Response) => {
    const trainer_id = req.trainer.id;

    const [
      activeStudents,
      mrrResult,
      todaySessions,
      blockedStudents,
    ] = await Promise.all([
      db('students').where({ trainer_id, is_active: true, is_blocked: false }).count('id as count').first(),
      db('students').where({ trainer_id, is_active: true, is_blocked: false }).sum('monthly_fee as total').first(),
      db('training_sessions as ts')
        .join('students as s', 'ts.student_id', 's.id')
        .where('s.trainer_id', trainer_id)
        .whereRaw("DATE(ts.started_at) = CURRENT_DATE")
        .count('ts.id as count').first(),
      db('students').where({ trainer_id, is_blocked: true }).count('id as count').first(),
    ]);

    // Taxa de adesão: alunos que treinaram nos últimos 7 dias
    const activeTrainers = await db('training_sessions as ts')
      .join('students as s', 'ts.student_id', 's.id')
      .where('s.trainer_id', trainer_id)
      .whereRaw("ts.started_at >= NOW() - INTERVAL '7 days'")
      .countDistinct('ts.student_id as count')
      .first();

    const total = Number(activeStudents?.count) || 1;
    const adherence = Math.round((Number(activeTrainers?.count) / total) * 100);

    res.json({
      trainer_name: req.trainer.name,
      active_students: Number(activeStudents?.count) || 0,
      mrr: Number(mrrResult?.total) || 0,
      sessions_today: Number(todaySessions?.count) || 0,
      blocked_students: Number(blockedStudents?.count) || 0,
      adherence: adherence || 0,
    });
  });

  return router;
}
