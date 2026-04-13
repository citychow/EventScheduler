// ─── State ───────────────────────────────────────────────────────────────────
let weekOffset = 1;
let allEvents = [];
let exportLog = [];

const DAYS_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];



// ─── Persistence backed by Server API ─────────────────────────────────────────────────────────────
async function load() {
  try {
    const res = await fetch('/api/events');
    if (res.ok) allEvents = await res.json();
  } catch(e) {
    console.warn('[load] Could not fetch events from server:', e.message);
  }
  try {
    const res = await fetch('/api/run-log');
    if (res.ok) exportLog = await res.json();
  } catch(e) {
    console.warn('[load] Could not fetch run-log from server:', e.message);
  }
}

// ─── Week helpers ─────────────────────────────────────────────────────────────
function getWeekDays(offset) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const mon = new Date(today);
  const dow = today.getDay();
  const diff = (dow === 0 ? -6 : 1 - dow);
  mon.setDate(today.getDate() + diff + offset * 7);
  return Array.from({length:7}, (_,i) => { const d = new Date(mon); d.setDate(mon.getDate()+i); return d; });
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

function changeWeek(delta) { weekOffset += delta; render(); }

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const days = getWeekDays(weekOffset);
  const todayStr = fmtDate(new Date());

  // Week label
  const s = days[0], e = days[6];
  document.getElementById('week-display').textContent =
    `${DAYS_SHORT[s.getDay()]} ${s.getDate()} ${MONTHS[s.getMonth()]} — ${DAYS_SHORT[e.getDay()]} ${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;

  // heading
  const label = weekOffset === 0 ? 'This week' : weekOffset === 1 ? 'Next week' : weekOffset === -1 ? 'Last week' : `Week of ${s.getDate()} ${MONTHS[s.getMonth()]}`;
  document.getElementById('schedule-heading').textContent = label;

  // schedule rows
  const list = document.getElementById('schedule-list');
  list.innerHTML = '';
  let weekEvents = [];

  days.forEach(day => {
    const key = fmtDate(day);
    const evs = allEvents.filter(e => e.date === key);
    weekEvents.push(...evs);
    const isToday = key === todayStr;

    const row = document.createElement('div');
    row.className = 'day-row';
    const labelEl = `
      <div class="day-label">
        <div class="day-name">${DAYS_SHORT[day.getDay()]}</div>
        <div class="day-num ${isToday ? 'today' : ''}">${String(day.getDate()).padStart(2,'0')}</div>
      </div>`;

    let evHtml = '<div class="day-events">';
    if (evs.length === 0) {
      evHtml += '<div class="no-event">No event</div>';
    } else {
      evs.forEach(ev => {
        evHtml += `<div class="event-entry">
          <span class="event-time">${ev.time}</span>
          <span class="event-name">${ev.name}</span>
          <span class="event-badge badge-${ev.type}">${ev.type}</span>
        </div>`;
      });
    }
    evHtml += '</div>';
    row.innerHTML = labelEl + evHtml;
    list.appendChild(row);
  });

  // summary strip
  const total = weekEvents.length;
  const football = weekEvents.filter(e => e.type === 'football').length;
  const concert = weekEvents.filter(e => e.type === 'concert').length;
  const other = weekEvents.filter(e => e.type !== 'football' && e.type !== 'concert').length;
  document.getElementById('s-total').textContent = total;
  document.getElementById('s-football').textContent = football;
  document.getElementById('s-concert').textContent = concert;
  document.getElementById('s-other').textContent = other;

  // Next event countdown
  const now = new Date();
  const upcoming = allEvents
    .map(e => ({ ...e, dt: new Date(e.date + 'T' + e.time) }))
    .filter(e => e.dt > now)
    .sort((a,b) => a.dt - b.dt);
  if (upcoming.length) {
    const diff = upcoming[0].dt - now;
    const dDays = Math.floor(diff / 86400000);
    document.getElementById('s-next').textContent = dDays === 0 ? 'Today' : `${dDays}d`;
  } else {
    document.getElementById('s-next').textContent = '—';
  }

  // Ticker
  const tickerEvents = allEvents
    .map(e => ({ ...e, dt: new Date(e.date + 'T' + e.time) }))
    .filter(e => e.dt >= new Date())
    .sort((a,b) => a.dt - b.dt)
    .slice(0, 8);
  document.getElementById('ticker-text').textContent = tickerEvents
    .map(e => `${e.date}  ${e.time}  ·  ${e.name.toUpperCase()}`)
    .join('     ✦     ');

  renderExportLog();
}

// ─── Export log ───────────────────────────────────────────────────────────────
function renderExportLog() {
  const el = document.getElementById('export-log');
  if (!exportLog.length) {
    el.innerHTML = '<div class="empty-log">No exports yet — run a check to generate the first export.</div>';
    return;
  }
  let html = '<table class="exports-table"><thead><tr><th>Timestamp</th><th>Week covered</th><th>Events found</th><th>File</th></tr></thead><tbody>';
  [...exportLog].reverse().forEach(entry => {
    html += `<tr>
      <td style="font-family:'DM Mono',monospace;font-size:12px;">${entry.timestamp}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;">${entry.week}</td>
      <td>${entry.count}</td>
      <td><a href="exports/${entry.filename}" download>${entry.filename}</a></td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ─── Export CSV (weekly) function ────────────────────────────────────────────────────────────────
function exportWeekCSV(weekLabel, weekDays) {
  const timestamp = new Date().toLocaleString('en-GB', { dateStyle:'short', timeStyle:'short' });
  const filename = `wembley-${fmtDate(weekDays[0])}.csv`;

  const escape = val => `"${String(val).replace(/"/g, '""')}"`;

  const rows = [
    `# Wembley Stadium - Weekly Monitor`,
    `# Week: ${weekLabel}`,
    `# Exported: ${timestamp}`,
    '',
    ['Date', 'Day', 'Time', 'Event Name', 'Type'].map(escape).join(','),
  ];

  weekDays.forEach(day => {
    const key = fmtDate(day);
    const evs = allEvents.filter(e => e.date === key);
    if (evs.length === 0) {
      rows.push([key, DAYS_LONG[day.getDay()], '', 'No event scheduled', ''].map(escape).join(','));
    } else {
      evs.forEach(ev =>
        rows.push([ev.date, DAYS_LONG[day.getDay()], ev.time, ev.name, ev.type].map(escape).join(','))
      );
    }
  });

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  const count = weekDays.flatMap(d => allEvents.filter(e => e.date === fmtDate(d))).length;
  exportLog.push({ timestamp, week: weekLabel, count, filename });
  renderExportLog();
}


// ─── Export CSV (all events) function ────────────────────────────────────────────────────────────────
function exportCSV() {
  const todayStr = fmtDate(new Date());
  const timestamp = new Date().toLocaleString('en-GB', { dateStyle:'short', timeStyle:'short' });
  const filename = `wembley-allEvents-${todayStr}.csv`;

  const escape = val => `"${String(val).replace(/"/g, '""')}"`;

  const rows = [
    `# Wembley Stadium - Weekly Monitor`,
    `# Exported: ${timestamp}`,
    `# Source: Ticketmaster Discovery API`,
    `# Showing all events from ${todayStr} onwards`,
    '',
    ['Date', 'Day', 'Time', 'Event Name', 'Type'].map(escape).join(','),
  ];

  allEvents
    .filter(e => e.date >= todayStr)
    .forEach(ev => {
      const day = new Date(ev.date).getDay();
      rows.push([ev.date, DAYS_LONG[day], ev.time, ev.name, ev.type].map(escape).join(','));
    });

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  const count = allEvents.filter(e => e.date >= todayStr).length;
  exportLog.push({ timestamp, week: `From ${todayStr}`, count, filename });
  renderExportLog();
}

// ─── Check Run ────────────────────────────────────────────────────────────────
async function runCheck() {
  const btn = document.getElementById('check-btn');
  const pill = document.getElementById('status-pill');
  btn.disabled = true;
  pill.className = 'status-pill running';
  pill.textContent = 'Checking...';

  // Simulate API fetch delay (in production this calls your backend/scheduler)
  await new Promise(r => setTimeout(r, 1200));

  const now = new Date();
  document.getElementById('last-run-time').textContent = now.toLocaleString('en-GB', { dateStyle:'medium', timeStyle:'short' });

  const days = getWeekDays(weekOffset);
  const s = days[0], e = days[6];
  const weekLabel = `${DAYS_SHORT[s.getDay()]} ${s.getDate()} ${MONTHS[s.getMonth()]} – ${DAYS_SHORT[e.getDay()]} ${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
  exportWeekCSV(weekLabel, days);

  pill.className = 'status-pill done';
  pill.textContent = 'Done ✓';
  btn.disabled = false;
  setTimeout(() => { pill.className = 'status-pill idle'; pill.textContent = 'Idle'; }, 3000);

  render();
}

async function fetchEvents() {
  const btn = document.getElementById('export-btn');
  const pill = document.getElementById('status-pill');
  btn.disabled = true;
  pill.className = 'status-pill running';
  pill.textContent = 'Exporting...';

  // Simulate API fetch delay (in production this calls your backend/scheduler)
  await new Promise(r => setTimeout(r, 1200));

  const now = new Date();
  document.getElementById('last-run-time').textContent = now.toLocaleString('en-GB', { dateStyle:'medium', timeStyle:'short' });

  exportCSV();

  pill.className = 'status-pill done';
  pill.textContent = 'Done ✓';
  btn.disabled = false;
  setTimeout(() => { pill.className = 'status-pill idle'; pill.textContent = 'Idle'; }, 3000);

  render();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  await load();
  render();
})();