#!/bin/bash

# Start all services with PM2

echo "Starting Twitter Tracker services..."

# Stop existing services if running
pm2 delete tracker-web 2>/dev/null || true
pm2 delete tracker-scrape 2>/dev/null || true

# Start web server
pm2 start server.js --name tracker-web

# Start nightly scraper (runs at midnight UTC)
pm2 start scrape_follows.js --name tracker-scrape --cron "0 0 * * *" --no-autorestart

# Save PM2 config
pm2 save

# Setup PM2 to start on boot
echo ""
echo "To make services start on reboot, run:"
echo "  pm2 startup"
echo "Then run the command it outputs."
echo ""

# Show status
pm2 status

echo ""
echo "Web UI running at: http://$(curl -s ifconfig.me):3000"
echo ""
echo "Useful commands:"
echo "  pm2 logs           # View all logs"
echo "  pm2 logs tracker-scrape  # View scraper logs"
echo "  pm2 restart all    # Restart services"
echo "  pm2 stop all       # Stop services"
echo ""
