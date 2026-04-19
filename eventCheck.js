const https = require('https');
require('dotenv').config();

const VENUES = [
  { id: 'KovZ9177ML0', name: 'Wembley Stadium' },
  { id: 'KovZ9177yOV', name: 'OVO Arena Wembley' },
  { id: 'KovZ9177W-7', name: 'Wembley Stadium VIP' },
];

function fetchVenueEvents(venueId) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      apikey: process.env.TM_API_KEY,
      venueId,
      size: '50',
      sort: 'date,asc'
    });

    https.get('https://app.ticketmaster.com/discovery/v2/events.json?' + params.toString(), res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error('Parse error: ' + raw.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

async function main() {
  for (const venue of VENUES) {
    console.log('\n' + '='.repeat(60));
    console.log(`VENUE: ${venue.name} (${venue.id})`);
    console.log('='.repeat(60));

    try {
      const data = await fetchVenueEvents(venue.id);
      const events = data._embedded ? data._embedded.events : [];
      const total = data.page ? data.page.totalElements : 0;

      console.log(`Total events in API: ${total}`);
      console.log(`Returned this page:  ${events.length}`);
      console.log('');

      if (events.length === 0) {
        console.log('  No events found.');
        if (data.errors) console.log('  Errors:', JSON.stringify(data.errors));
        continue;
      }

      // group by date for cleaner output
      const byDate = {};
      events.forEach(e => {
        const date = e.dates.start.localDate;
        if (!byDate[date]) byDate[date] = [];
        const isPremium = e.name.toLowerCase().includes('venue premium');
        const seg = e.classifications?.[0]?.segment?.name || 'unknown';
        const genre = e.classifications?.[0]?.genre?.name || 'unknown';
        byDate[date].push({ name: e.name, isPremium, seg, genre });
      });

      Object.keys(byDate).sort().forEach(date => {
        byDate[date].forEach(e => {
          const flag = e.isPremium ? ' [PREMIUM DUPE]' : '';
          console.log(`  ${date} | ${e.name}${flag} | ${e.seg} / ${e.genre}`);
        });
      });

    } catch(err) {
      console.log(`  ERROR: ${err.message}`);
    }

    // small delay between requests
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n' + '='.repeat(60));
  console.log('Done.');
}

main().catch(console.error);