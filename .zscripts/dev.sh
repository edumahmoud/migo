#!/bin/bash
cd /home/z/my-project

# Install dependencies if needed
bun install

# Push database schema
bun run db:push

# Start the Socket.IO chat service with auto-restart
(
  cd /home/z/my-project/mini-services/chat-service
  while true; do
    echo "[$(date)] Starting chat service..." >> /tmp/chat-svc.log
    bun index.ts >> /tmp/chat-svc.log 2>&1
    echo "[$(date)] Chat service exited, restarting in 3s..." >> /tmp/chat-svc.log
    sleep 3
  done
) &

# Wait for chat service to start
sleep 2

# Start the Next.js dev server (main process)
exec node node_modules/.bin/next dev -p 3000
