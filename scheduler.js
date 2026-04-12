#!/usr/bin/env node
/**
 * Wembley Monitor — Scheduler
 * Runs as a background Node.js process.
 * Only run when scheduler.js is called. Repeating handled by pm2. 
 * Every Friday at 14:00 (configurable) it:
 *   1. Calls the Ticketmaster Discovery API (free, no billing required)
 *   2. Parses events for Wembley Stadium (venue ID: KovZpZAFnIeA)
 *   3. Writes events.json (read by index.html)
 *   4. Exports a .csv file into ./exports/
 *   5. Logs the run to run-log.json
 *
 * Usage:
 *   node scheduler.js
 *   node scheduler.js --run-now       (run immediately then schedule)
 *   node scheduler.js --day 5         (day 0=Sun … 6=Sat, default 5=Fri)
 *   node scheduler.js --time 14:00    (24h time, default 14:00)
 *
 * API key:
 *   Get a free key at https://developer.ticketmaster.com
 *   Then either set TM_API_KEY env var, or create tm-api-key.txt in this folder.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

// ─── Config ───────────────────────────────────────────────────────────────────
const EXPORTS_DIR  = path.join(__dirname, 'exports');
const EVENTS_FILE  = path.join(__dirname, 'events.json');
const LOG_FILE     = path.join(__dirname, 'run-log.json');
const TM_KEY_FILE  = path.join(__dirname, 'tm-api-key.txt');

// Wembley Stadium venue ID on Ticketmaster
const WEMBLEY_VENUE_ID = 'KovZpZAFnIeA,KovZpZAEknlA';

// create exports dir if missing
if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

// ─── API key ──────────────────────────────────────────────────────────────────
function getApiKey() {
  if (process.env.TM_API_KEY) return process.env.TM_API_KEY;
  if (fs.existsSync(TM_KEY_FILE)) return fs.readFileSync(TM_KEY_FILE, 'utf8').trim();
  console.error('[ERROR] No Ticketmaster API key found.');
  console.error('  → Get a free key at https://developer.ticketmaster.com');
  console.error('  → Then set TM_API_KEY env var, or create tm-api-key.txt in this folder.');
  process.exit(1);
}

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const runNow  = args.includes('--run-now');
const dayArg  = args.indexOf('--day');
const timeArg = args.indexOf('--time');
const SCHED_DAY  = dayArg  !== -1 ? parseInt(args[dayArg  + 1]) : 5;
const SCHED_TIME = timeArg !== -1 ? args[timeArg + 1]           : '14:00';

const DAY_NAMES  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ─── Ticketmaster API ─────────────────────────────────────────────────────────
async function fetchTicketmaster(startDate, endDate) {
  const allEvents = [];
  let page = 0;
  let totalPages = 1;

  // Convert local midnight to correct UTC time
const toUTC = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toISOString().replace('.000Z', 'Z');
};

  while (page < totalPages) {
    const params = new URLSearchParams({
      apikey:        getApiKey(),
      venueId:       WEMBLEY_VENUE_ID,
      startDateTime: toUTC(startDate),  // keep Z for correct fetching
      endDateTime:   new Date(endDate + 'T23:59:59').toISOString().replace('.000Z', 'Z'),
      size:          '50',
      page:          String(page),
      sort:          'date,asc',
    });

    const data = await new Promise((resolve, reject) => {
      https.get({
          hostname: 'app.ticketmaster.com',
          path:     `/discovery/v2/events.json?${params}`,
          headers:  { 'Accept': 'application/json' }
        }, res => {
          let raw = '';
          res.on('data', chunk => raw += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(raw)); }
            catch(e) { reject(new Error('JSON parse error: ' + raw.slice(0, 200))); }
          });
        }).on('error', reject);
    });

    if (data.errors || data.fault) {
      console.error('[Ticketmaster] API error:', JSON.stringify(data.errors || data.fault));
      break;
    }

    const events = data?._embedded?.events || [];
    allEvents.push(...events);
    totalPages = data.page?.totalPages ?? 1;
    console.log(`[Ticketmaster] Page ${page + 1}/${totalPages} — ${events.length} events`);
    page++;
  }

  return allEvents;
}

// ─── Parse Ticketmaster response into our event shape ─────────────────────────
function parseTicketmasterEvents(items) {
  return items.map(ev => {
    const dateInfo = ev.dates?.start;
    const date = dateInfo?.localDate || '';
    const time = dateInfo?.localTime?.slice(0, 5) || '19:00';
    const name = ev.name || 'Unknown event';
    const segment = ev.classifications?.[0]?.segment?.name?.toLowerCase() || '';
    const genre   = ev.classifications?.[0]?.genre?.name?.toLowerCase()   || '';

    let type = 'sport';
    if (segment === 'music' || genre.includes('concert')) type = 'concert';
    else if (genre.includes('football') || genre.includes('soccer'))  type = 'football';
    else if (name.toLowerCase().includes('charity')) type = 'charity';
    else if (segment === 'sports') type = 'sport';

    return { date, name, time, type };
  }).filter(e => e.date);
}

// ─── Merge new events with existing (dedup by date+name) ─────────────────────
function mergeEvents(existing, fresh) {
  const map = new Map();
  existing.forEach(e => map.set(e.date + '|' + e.name, e));
  fresh.forEach(e => map.set(e.date + '|' + e.name, e));
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ─── CSV export (zero dependencies, pure Node built-ins) ─────────────────────
function exportToCSV(events) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const filename = `wembley-${todayStr}.csv`;
  const filepath = path.join(EXPORTS_DIR, filename);

  const escape = val => `"${String(val).replace(/"/g, '""')}"`;

  const rows = [
    `# Wembley Stadium — Weekly Monitor`,
    `# Exported: ${new Date().toLocaleString('en-GB')}`,
    `# Source: Ticketmaster Discovery API`,
    '',
    ['Date', 'Day', 'Time', 'Event Name', 'Type'].map(escape).join(','),
  ];

  events.filter(e => e.date >= todayStr).forEach(ev => { rows.push([
    ev.date,
    DAY_NAMES[new Date(ev.date).getDay()],
    ev.time,
    ev.name,
    ev.type
  ].map(escape).join(',')); });

  fs.writeFileSync(filepath, rows.join('\n'), 'utf8');
  console.log(`[Export] CSV saved: ${filepath}`);
  return filename;
}

// ─── Main check run ───────────────────────────────────────────────────────────
async function runCheck() {
  const now = new Date();
  console.log(`\n[${now.toLocaleString('en-GB')}] Running Wembley schedule check...`);

  // Next week Mon–Sun
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const daysToMon = dow === 0 ? 1 : (8 - dow);
  const nextMon = new Date(today);
  nextMon.setDate(today.getDate() + daysToMon);
  const nextSun = new Date(nextMon);
  nextSun.setDate(nextMon.getDate() + 6);

  // const isoDate = d => d.toISOString().split('T')[0];
  const fmtDate = d => {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
  const fmt     = d => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const weekLabel = `${DAYS_SHORT[nextMon.getDay()]} ${fmt(nextMon)} – ${DAYS_SHORT[nextSun.getDay()]} ${fmt(nextSun)}`;

  // Fetch from Ticketmaster — next week + full upcoming (next 12 months)
  let freshEvents = [];
  try {
    const today12m = new Date(today);
    today12m.setFullYear(today12m.getFullYear() + 1);

    console.log(`[Ticketmaster] Fetching events ${fmtDate(today)} → ${fmtDate(today12m)}...`);
    const tmItems = await fetchTicketmaster(fmtDate(today), fmtDate(today12m));
    freshEvents = parseTicketmasterEvents(tmItems);
    console.log(`[Ticketmaster] ${freshEvents.length} total events fetched`);
  } catch(err) {
    console.error('[Ticketmaster] Fetch error:', err.message);
  }

  // Merge with existing and save
  let existing = [];
  if (fs.existsSync(EVENTS_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')); } catch(e) {}
  }
  const merged = mergeEvents(existing, freshEvents);
  
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(merged, null, 2));
  console.log(`[Events] Saved ${merged.length} total events to events.json`);

  // Export CSV
  const filename = exportToCSV(merged);

  // Run log
  let log = [];
  if (fs.existsSync(LOG_FILE)) {
    try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch(e) {}
  }
  log.push({
    timestamp:   now.toLocaleString('en-GB'),
    week:        weekLabel,
    eventsFound: freshEvents.length,
    totalEvents: merged.length,
    exportFile:  filename,
    source:      'Ticketmaster Discovery API',
  });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log.slice(-50), null, 2));
  console.log(`[Log] Run logged to run-log.json`);
  console.log(`[Done] Check complete.\n`);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════╗');
console.log('║     Wembley Stadium Weekly Monitor           ║');
console.log('║     Powered by Ticketmaster Discovery API    ║');
console.log('╚══════════════════════════════════════════════╝');
console.log(`Schedule:   every ${DAY_NAMES[SCHED_DAY]} at ${SCHED_TIME}`);
console.log(`Events file: ${EVENTS_FILE}`);
console.log(`Exports dir: ${EXPORTS_DIR}`);
console.log('');

runCheck().catch(err => {
  console.error('[Fatal] Uncaught error in runCheck:', err);
  process.exit(1);
});
