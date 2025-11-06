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

import { cfg } from './lib/config.js';
import { normalizeClients, normalizeTransactions } from './lib/csv-normalize.js';
import { scoreAll } from './lib/rules.js';
import { buildCases } from './lib/cases.js';
import { buildManifest } from './lib/manifest.js';
import { zipNamedBuffers } from './lib/zip.js';
import { verifyStore } from './lib/verify-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false })); // tighten later when you pin exact asset origins
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.use(cors({
  origin: [cfg.MARKETING_ORIGIN],
  methods: ['GET','POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 2 }
});

// Health
app.get('/healthz', (_req, res) => res.send('ok'));

// Minimal app UI (front-end will be separate; this is functional)
app.get('/', (_req, res) => res.render('app'));

// Upload → process → evidence
app.post('/upload', upload.fields([{ name: 'clients', maxCount: 1 }, { name: 'transactions', maxCount: 1 }]), async (req, res) => {
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
    console.error(e);
    res.status(500).json({ error: 'Processing failed.' });
  }
});

// Verify + download
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

// Optional Stripe
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
      success_url: cfg.MARKETING_ORIGIN + '/payment.html?success=1',
      cancel_url: cfg.MARKETING_ORIGIN + '/payment.html?canceled=1',
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Stripe error' });
  }
});

app.listen(cfg.PORT, () => console.log(`TrancheReady app listening on ${cfg.PORT}`));
