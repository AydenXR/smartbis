#!/bin/bash
set -e

cd /var/www/smartbis

echo "==> Git pull"
git pull

echo "==> Installing dependencies"
npm install

echo "==> Building app"
npm run build

echo "==> Restarting API"
pm2 restart smartbis-api

echo "==> Done"
