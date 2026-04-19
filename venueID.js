const https = require('https');
require('dotenv').config();
const params = new URLSearchParams({
  apikey: process.env.TM_API_KEY,
  keyword: 'wembley',
  countryCode: 'GB',
  size: '10'
});
https.get({
  hostname: 'app.ticketmaster.com',
  path: '/discovery/v2/venues.json?' + params,
  headers: { Accept: 'application/json' }
}, res => {
  let raw = '';
  res.on('data', c => raw += c);
  res.on('end', () => {
   const data = JSON.parse(raw);
   data._embedded.venues.forEach(v =>
   console.log(v.id, '|', v.name, '|', v.city?.name)
 );
  });
}).on('error', console.error);