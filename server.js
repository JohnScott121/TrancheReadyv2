import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import multer from 'multer';
import { parse as csvParse } from 'csv-parse/sync';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';
import pino from 'pino';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';

import { cfg } from './lib/config.js';
import { normalizeClients, normalizeTransactions } from './lib/csv-normalize.js';
import { scoreAll } from './lib/rules.js';
import { buildCases } from './lib/cases.js';
import { buildManifest } from './lib/manifest.js';
import { zipNamedBuffers } from './lib/zip.js';
import { verifyStore } from './lib/verify-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Logger (redacts secrets) ----------
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: { paths: ['req.headers.authorization', '*.secret', '*.key', '*.password'], censor: '[redacted]' }
});
const httpLogger = pinoHttp({ logger, customLogLevel: (_, res, err) => err ? 'error' : res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info' });

// ---------- App ----------
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Middleware ----------
app.use(httpLogger);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(compression());

// Helmet with explicit CSP (relax if you add external assets)
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"], // inline styles from EJS/css
      "img-src": ["'self'","data:"],
      "connect-src": ["'self'"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: "same-origin" }
}));

// Static
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

// Strict CORS for marketing site
app.use(cors({
  origin: (origin, cb) => {
    // Allow tools and same-origin; otherwise only MARKETING_ORIGIN
    if (!origin || origin === cfg.APP_ORIGIN || origin === cfg.MARKETING_ORIGIN) return cb(null, true);
    return cb(new Error('CORS blocked'), false);
  },
  methods: ['GET','POST'],
  allowedHeaders: ['Content-Type']
}));

// Rate limits (stricter on heavy endpoints)
const baseLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
const heavyLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60 });
app.use(baseLimiter);

// Uploads (memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 2 }
});

// ---------- Health & status ----------
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    verify_store_entries: verifyStore.map?.size ?? 'n/a'
  });
});
app.get('/api/version', (_req, res) => {
  res.json({
    name: 'trancheready-app',
    version: '1.1.0',
    ruleset_id: 'dnfbp-2025.11',
    lookback_months: 18
  });
});

// ---------- Docs (OpenAPI) ----------
const openapiPath = path.join(__dirname, 'docs', 'openapi.yaml');
if (fs.existsSync(openapiPath)) {
  const yaml = fs.readFileSync(openapiPath, 'utf8');
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(undefined, {
    swaggerOptions: { url: '/docs/openapi.yaml' },
    customSiteTitle: 'TrancheReady API Docs'
  }));
  app.get('/docs/openapi.yaml', (_req, res) => res.type('text/yaml').send(yaml));
}

// ---------- Minimal app UI ----------
app.get('/', (_req, res) => res.render('app'));

// ---------- Templates & validation ----------
app.get('/api/templates', (_req, res) => {
  // ?name=clients or ?name=transactions — returns CSV template
  const name = (_req.query.name || '').toString().toLowerCase();
  const file = name === 'transactions' ? 'Transactions.template.csv' : 'Clients.template.csv';
  const full = path.join(__dirname, 'public', 'templates', file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Template not found' });
  res.setH
