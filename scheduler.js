#!/usr/bin/env node
/**
 * Wembley Monitor — Scheduler
 * Runs as a background Node.js process.
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

// Wembley Stadium venue ID on Ticketmaster
const WEMBLEY_VENUE_ID = 'KovZpZAFnIeA,KovZpZAEknlA';

// create a new folder for CSV exports if it doesn't exist
if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

// ─── API key ──────────────────────────────────────────────────────────────────
function getApiKey() {
  if (process.env.TM_API_KEY) return process.env.TM_API_KEY;
  console.error('[ERROR] No Ticketmaster API key found.');
  console.error('  → Get a free key at https://developer.ticketmaster.com');
  console.error('  → Remember to set TM_API_KEY env var.');
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
function fetchTicketmaster(startDate, endDate) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      apikey:  getApiKey(),
      venueId: WEMBLEY_VENUE_ID,
      startDateTime: startDate + 'T00:00:00Z',
      endDateTime:   endDate   + 'T23:59:59Z',
      size: '50',
      sort: 'date,asc',
    });

    const options = {
      hostname: 'app.ticketmaster.com',
      path: `/discovery/v2/events.json?${params}`,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };

    https.get(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

// ─── Parse Ticketmaster response into our event shape ─────────────────────────
function parseTicketmasterEvents(tmData) {
  const items = tmData?._embedded?.events || [];
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
function exportToCSV(events, weekLabel, weekStart) {
  const dateStr  = weekStart.toISOString().split('T')[0];
  const filename = `wembley-${dateStr}.csv`;
  const filepath = path.join(EXPORTS_DIR, filename);

  const escape = val => `"${String(val).replace(/"/g, '""')}"`;

  const rows = [
    `# Wembley Stadium — Weekly Monitor`,
    // `# Week: ${weekLabel}`,
    `# Exported: ${new Date().toLocaleString('en-GB')}`,
    `# Source: Ticketmaster Discovery API`,
    '',
    ['Date', 'Day', 'Time', 'Event Name', 'Type'].map(escape).join(','),
  ];

  // for (let i = 0; i < 14; i++) {
  //   // const d = new Date(weekStart);
  //   // d.setDate(weekStart.getDate() + i);
  //   // const key = d.toISOString().split('T')[0];
  //   const evs = events.filter(e => e.date === key);
  //   if (evs.length === 0) {
  //     rows.push([key, DAY_NAMES[d.getDay()], '', 'No event scheduled', ''].map(escape).join(','));
  //   } else {
  //     evs.forEach(ev =>
  //       rows.push([ev.date, DAY_NAMES[d.getDay()], ev.time, ev.name, ev.type].map(escape).join(','))
  //     );
  //   }
  // }

  for (const ev of events) {
    const d = new Date(ev.date);
    rows.push([ev.date, DAY_NAMES[d.getDay()], ev.time, ev.name, ev.type].map(escape).join(','));
  }

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

  const isoDate = d => d.toISOString().split('T')[0];
  const fmt     = d => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const weekLabel = `${DAYS_SHORT[nextMon.getDay()]} ${fmt(nextMon)} – ${DAYS_SHORT[nextSun.getDay()]} ${fmt(nextSun)}`;

  // Fetch from Ticketmaster — next week + full upcoming (next 12 months)
  let freshEvents = [];
  try {
    const today12m = new Date(today);
    today12m.setFullYear(today12m.getFullYear() + 1);

    console.log(`[Ticketmaster] Fetching events ${isoDate(today)} → ${isoDate(today12m)}...`);
    const tmData = await fetchTicketmaster(isoDate(today), isoDate(today12m));

    if (tmData.errors || tmData.fault) {
      console.error('[Ticketmaster] API error:', JSON.stringify(tmData.errors || tmData.fault));
    } else {
      freshEvents = parseTicketmasterEvents(tmData);
      const page = tmData.page || {};
      console.log(`[Ticketmaster] ${freshEvents.length} events fetched (page ${(page.number||0)+1} of ${page.totalPages||1}, total ${page.totalElements||freshEvents.length})`);
    }
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
  const filename = exportToCSV(merged, weekLabel, nextMon);

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

// ─── Scheduler ────────────────────────────────────────────────────────────────
function msUntilNext(dayOfWeek, timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  let daysAhead = (dayOfWeek - now.getDay() + 7) % 7;
  if (daysAhead === 0 && target <= now) daysAhead = 7;
  target.setDate(now.getDate() + daysAhead);
  return target - now;
}

function scheduleNext() {
  const ms   = msUntilNext(SCHED_DAY, SCHED_TIME);
  const next = new Date(Date.now() + ms);
  console.log(`[Scheduler] Next auto-check: ${DAY_NAMES[SCHED_DAY]} at ${SCHED_TIME} (${next.toLocaleString('en-GB')})`);
  setTimeout(async () => {
    await runCheck();
    scheduleNext();
  }, ms);
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

if (runNow) {
  runCheck().then(() => scheduleNext());
} else {
  scheduleNext();
}
