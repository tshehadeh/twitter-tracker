#!/bin/bash

# Oracle Cloud Server Setup Script
# Run this after SSH'ing into your new VM

set -e

echo "=== Twitter Tracker Server Setup ==="

# Update system
echo "Updating system..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install build tools (needed for better-sqlite3)
echo "Installing build tools..."
sudo apt install -y build-essential python3

# Install PM2 globally
echo "Installing PM2..."
sudo npm install -g pm2

# Install dependencies
echo "Installing project dependencies..."
npm install

# Create directories
mkdir -p data logs

# Check for .env file
if [ ! -f .env ]; then
    echo ""
    echo "=== IMPORTANT ==="
    echo "Create your .env file with your Twitter credentials:"
    echo ""
    echo "  nano .env"
    echo ""
    echo "Add these lines:"
    echo "  AUTH_TOKEN=your_auth_token"
    echo "  CSRF_TOKEN=your_csrf_token"
    echo "  TWID=your_twid"
    echo "  PORT=3000"
    echo ""
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Create .env file with your Twitter credentials"
echo "2. Initialize database: node init_core_nodes.js"
echo "3. Start services: ./start-services.sh"
echo ""
