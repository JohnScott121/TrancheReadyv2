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
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
  fs.createReadStream(full).pipe(res);
});

app.post('/api/validate', heavyLimiter, upload.fields([{ name: 'clients', maxCount: 1 }, { name: 'transactions', maxCount: 1 }]), (req, res) => {
  try {
    const clientsFile = req.files?.clients?.[0];
    const txFile = req.files?.transactions?.[0];
    if (!clientsFile || !txFile) return res.status(400).json({ ok:false, error: 'Both files required' });
    const clientsCsv = csvParse(clientsFile.buffer.toString('utf8'), { columns: true, skip_empty_lines: true });
    const txCsv = csvParse(txFile.buffer.toString('utf8'), { columns: true, skip_empty_lines: true });

    const { clientHeaderMap } = normalizeClients(clientsCsv);
    const { txHeaderMap, rejects, lookback } = normalizeTransactions(txCsv);

    res.json({ ok:true, clientHeaderMap, txHeaderMap, rejects, lookback });
  } catch (e) {
    req.log.error(e, 'validate_failed');
    res.status(500).json({ ok:false, error: 'Validation failed' });
  }
});

// ---------- Upload → evidence ----------
app.post('/upload', heavyLimiter, upload.fields([{ name: 'clients', maxCount: 1 }, { name: 'transactions', maxCount: 1 }]), async (req, res) => {
  try {
    const clientsFile = req.files?.clients?.[0];
    const txFile = req.files?.transactions?.[0];
    if (!clientsFile || !txFile) return res.status(400).json({ error: 'Both Clients.csv and Transactions.csv are required.' });

    const clientsCsv = csvParse(clientsFile.buffer.toString('utf8'), { columns: true, skip_empty_lines: true });
    const txCsv = csvParse(txFile.buffer.toString('utf8'), { columns: true, skip_empty_lines: true });

    const { clients, clientHeaderMap } = normalizeClients(clientsCsv);
    const { txs, txHeaderMap, rejects, lookback } = normalizeTransactions(txCsv);

    const { scores, rulesMeta } = await scoreAll(clients, txs, lookback, cfg.OPENAI_API_KEY);
    const cases = buildCases(txs, lookback);

    const files = {
      'clients.json': Buffer.from(JSON.stringify(clients, null, 2)),
      'transactions.json': Buffer.from(JSON.stringify(txs, null, 2)),
      'cases.json': Buffer.from(JSON.stringify(cases, null, 2)),
      'program.html': Buffer.from([
        '<!doctype html><meta charset="utf-8"><title>Program</title>',
        `<h1>TrancheReady Evidence</h1>`,
        `<p>Generated: ${new Date().toISOString()}</p>`,
        `<h2>Ruleset</h2><pre>${JSON.stringify(rulesMeta, null, 2)}</pre>`,
        `<h2>Header Mapping</h2><pre>${JSON.stringify({ clients: clientHeaderMap, transactions: txHeaderMap }, null, 2)}</pre>`,
        `<h2>Row rejects</h2><pre>${JSON.stringify(rejects, null, 2)}</pre>`
      ].join(''))
    };

    const manifest = buildManifest(files, rulesMeta);
    const zipBuffer = await zipNamedBuffers({
      ...files,
      'manifest.json': Buffer.from(JSON.stringify(manifest, null, 2))
    });

    const token = crypto.randomBytes(16).toString('hex');
    verifyStore.put(token, zipBuffer, manifest, cfg.VERIFY_TTL_MIN);

    res.json({
      ok: true,
      risk: scores,
      verify_url: new URL('/verify/' + token, cfg.APP_ORIGIN).toString(),
      download_url: new URL('/download/' + token, cfg.APP_ORIGIN).toString()
    });
  } catch (e) {
    req.log.error(e, 'processing_failed');
    res.status(500).json({ error: 'Processing failed.' });
  }
});

// ---------- Verify & download ----------
app.get('/verify/:token', (req, res) => {
  const entry = verifyStore.get(req.params.token);
  if (!entry) return res.status(404).send('Link expired or not found.');
  res.render('verify', { manifest: entry.manifest, publicKey: cfg.SIGN_PUBLIC_KEY });
});
app.get('/download/:token', (req, res) => {
  const entry = verifyStore.get(req.params.token);
  if (!entry) return res.status(404).send('Link expired or not found.');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="trancheready-evidence.zip"');
  res.send(entry.zipBuffer);
});

// ---------- Stripe (optional) ----------
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!cfg.STRIPE_SECRET_KEY) return res.status(400).json({ error: 'Stripe not configured.' });
    const stripe = new Stripe(cfg.STRIPE_SECRET_KEY);
    const plan = (req.body?.plan || '').toLowerCase();
    const priceId = plan === 'team' ? cfg.STRIPE_PRICE_ID_TEAM : cfg.STRIPE_PRICE_ID_STARTER;
    if (!priceId) return res.status(400).json({ error: 'Price ID not set.' });
    const session = await stripe.checkout.sessions.create({
      mode: plan === 'team' ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: cfg.MARKETING_ORIGIN + '/pricing.html?success=1',
      cancel_url: cfg.MARKETING_ORIGIN + '/pricing.html?canceled=1',
    });
    res.json({ url: session.url });
  } catch (e) {
    req.log.error(e, 'stripe_error');
    res.status(500).json({ error: 'Stripe error' });
  }
});

// ---------- Start (with graceful shutdown) ----------
const server = app.listen(cfg.PORT, () => logger.info({ port: cfg.PORT }, 'TrancheReady app listening'));

function shutdown(signal){
  logger.info({ signal }, 'shutting_down');
  server.close(() => {
    logger.info('http_server_closed');
    process.exit(0);
  });
  setTimeout(()=>process.exit(1), 8000).unref();
}
['SIGTERM','SIGINT'].forEach(s => process.on(s, () => shutdown(s)));
