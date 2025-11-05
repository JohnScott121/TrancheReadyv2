import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import crypto from 'crypto';
import archiver from 'archiver';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';
import { buildManifest } from './lib/manifest.js';
import { runRules } from './lib/rules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false })); // tighten later
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const MARKETING_ORIGIN = process.env.MARKETING_ORIGIN || 'http://localhost:5500';
app.use(cors({
  origin: [MARKETING_ORIGIN],
  methods: ['GET','POST'],
  allowedHeaders: ['Content-Type'],
}));

const limiter = rateLimit({ windowMs: 15*60*1000, max: 300 });
app.use(limiter);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// In-memory verify store (starter only)
const verifyStore = new Map(); // token -> { expiresAt: Date, zipBuffer, manifest }

// Health
app.get('/healthz', (req,res)=> res.send('ok'));

// App UI (upload page)
app.get('/', (req, res) => {
  res.render('app', { title: 'TrancheReady — App' });
});

// Verify page
app.get('/verify/:token', (req, res) => {
  const { token } = req.params;
  const entry = verifyStore.get(token);
  if (!entry || entry.expiresAt < new Date()) {
    return res.status(404).send('Link expired or not found.');
  }
  res.render('verify', { manifest: entry.manifest, publicKey: process.env.SIGN_PUBLIC_KEY || '' });
});

// Download ZIP
app.get('/download/:token', (req,res) => {
  const { token } = req.params;
  const entry = verifyStore.get(token);
  if (!entry || entry.expiresAt < new Date()) return res.status(404).send('Link expired');
  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition','attachment; filename="trancheready-evidence.zip"');
  res.send(entry.zipBuffer);
});

// Upload handler
app.post('/upload', upload.fields([{ name:'clients', maxCount:1 }, { name:'transactions', maxCount:1 }]), async (req, res) => {
  try {
    const clientsFile = req.files?.clients?.[0];
    const txFile = req.files?.transactions?.[0];
    if (!clientsFile || !txFile) return res.status(400).json({ error: 'Both clients and transactions CSV required.' });

    const clients = parse(clientsFile.buffer.toString('utf8'), { columns: true, skip_empty_lines: true });
    const txs = parse(txFile.buffer.toString('utf8'), { columns: true, skip_empty_lines: true });

    // Minimal example scoring; replace with your full rules
    const { scores, cases } = runRules(clients, txs);

    const files = {
      'clients.json': Buffer.from(JSON.stringify(clients, null, 2)),
      'transactions.json': Buffer.from(JSON.stringify(txs, null, 2)),
      'cases.json': Buffer.from(JSON.stringify(cases, null, 2)),
      'program.html': Buffer.from(`<!doctype html><meta charset="utf-8"><title>Program</title><h1>TrancheReady Evidence</h1><p>Generated ${new Date().toISOString()}</p>`)
    };

    // Build manifest (hash each file, sign if key present)
    const manifest = buildManifest(files);

    // ZIP everything
    const zipBuffer = await zipFiles({ ...files, 'manifest.json': Buffer.from(JSON.stringify(manifest, null, 2)) });

    // Verify token (starter: memory only)
    const token = crypto.randomBytes(16).toString('hex');
    const ttlMin = parseInt(process.env.VERIFY_TTL_MIN || '60', 10);
    verifyStore.set(token, { zipBuffer, manifest, expiresAt: new Date(Date.now() + ttlMin*60*1000) });

    return res.json({
      ok: true,
      risk: scores,
      verify_url: new URL('/verify/' + token, process.env.APP_ORIGIN || 'http://localhost:10000').toString(),
      download_url: new URL('/download/' + token, process.env.APP_ORIGIN || 'http://localhost:10000').toString()
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Processing failed.' });
  }
});

async function zipFiles(namedBuffers) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', d => chunks.push(d));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    for (const [name, buf] of Object.entries(namedBuffers)) {
      archive.append(buf, { name });
    }
    archive.finalize();
  });
}

// Payments (Stripe Checkout)
app.post('/api/create-checkout-session', async (req,res) => {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.status(400).json({ error: 'Stripe not configured.' });
    const stripe = new Stripe(key);
    const plan = (req.body?.plan || '').toLowerCase();
    const priceId = plan === 'team' ? process.env.STRIPE_PRICE_ID_TEAM : process.env.STRIPE_PRICE_ID_STARTER;
    if (!priceId) return res.status(400).json({ error: 'Price ID not set.' });
    const session = await stripe.checkout.sessions.create({
      mode: plan === 'team' ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: (process.env.MARKETING_ORIGIN || '') + '/payment.html?success=1',
      cancel_url: (process.env.MARKETING_ORIGIN || '') + '/payment.html?canceled=1',
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Stripe error' });
  }
});

// Start
const port = process.env.PORT || 10000;
app.listen(port, () => console.log('TrancheReady app listening on', port));
