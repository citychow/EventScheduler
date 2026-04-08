# Wembley Stadium Weekly Monitor

Automatically checks Wembley Stadium's event schedule every Friday at 14:00,
updates the dashboard, and exports an `.csv` file.

---

## What's inside

```
wembley-monitor/
├── index.html        ← Open this in your browser (the dashboard)
├── scheduler.js      ← Node.js background process (auto-checker)
├── package.json      ← Dependencies
├── api-key.txt       ← Put your Anthropic API key here (create this file)
├── events.json       ← Auto-generated: current event list
├── run-log.json      ← Auto-generated: history of check runs
└── exports/          ← Auto-generated: .xlsx files saved here
```

---

## Quick start

### Step 1 — Install Node.js (if not already installed)
Download from https://nodejs.org (LTS version recommended)

### Step 2 — Install dependencies
Open Terminal (Mac/Linux) or Command Prompt (Windows) in this folder and run:
```
npm install
```

### Step 3 — Get a free Ticketmaster API key
1. Go to https://developer.ticketmaster.com and sign up (free)
2. Create an app — any name works (e.g. "wembley-monitor")
3. Copy your **Consumer Key**
4. Create a file called `tm-api-key.txt` in this folder and paste the key inside

Or set it as an environment variable:
```
export TM_API_KEY=your-key-here    # Mac/Linux
set TM_API_KEY=your-key-here       # Windows
```
The free tier allows 5,000 API calls/day — the monitor uses 1 per week.

### Step 4 — Start the scheduler
```
npm start
```
This runs as a background process and waits until the next Friday at 14:00.

### Step 5 — Open the dashboard
Simply open `index.html` in any browser. No web server needed.

---

## Options

**Run a check immediately** (useful for first test):
```
node scheduler.js --run-now
```

**Change the schedule day** (0=Sun, 1=Mon … 6=Sat):
```
node scheduler.js --day 4          # Thursday
```

**Change the schedule time**:
```
node scheduler.js --time 09:00     # 9am instead of 2pm
```

**Combine options**:
```
node scheduler.js --day 4 --time 09:00 --run-now
```

---

## How it works

1. **Scheduler** (`scheduler.js`) wakes up at your configured time
2. It fetches from TicketMaster API with web search enabled
3. Claude searches Wembley's official site and returns events as JSON
4. Events are **merged** with the existing list and saved to `events.json`
5. An **CSV file** is exported to `./exports/wembley-YYYY-MM-DD.csv`
6. The run is **logged** to `run-log.json`
7. When you open `index.html`, it reads `events.json` and displays the latest data

The dashboard (`index.html`) also has its own in-browser scheduler that
can trigger a visual refresh. For the full automated flow including XLSX
export, keep `scheduler.js` running in the background.

---

## Keeping it running in the background

**Mac/Linux** — run with nohup so it survives terminal close:
```
nohup node scheduler.js > wembley.log 2>&1 &
```

**Windows** — run in a minimised Command Prompt, or use Task Scheduler
to run `node scheduler.js --run-now` every Friday at 14:00.

---

## CSV export location

Files are saved to `./exports/` with names like:
```
wembley-2026-04-13.csv
```
Each file contains the 7-day weekly schedule with columns: Date, Day, Time, Event Name, Type.
CSV opens natively in Excel, Numbers, and Google Sheets — no plugins needed.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Error: No Ticketmaster API key found` | Create `tm-api-key.txt` or set `TM_API_KEY` env var |
| Dashboard shows no events | Run `node scheduler.js --run-now` to populate events.json |
| Scheduler stops | Restart with `npm start`; use nohup for persistence |

## To be updated
1. Change event duration for export as two weeks from today
2. Update text description at frontend and exported files
3. Allow user selectable venue search
