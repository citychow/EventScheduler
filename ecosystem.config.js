module.exports = {
  apps: [
    {
      name:         'wembley-scheduler',
      script:       'scheduler.js',
      cron_restart: '0 13 * * 5',   // every Friday at 14:00 (UTC+1)
      autorestart:  false,           // don't restart after clean exit
      watch:        false,
    }
  ]
};