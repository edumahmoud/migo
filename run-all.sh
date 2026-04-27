#!/bin/bash
# Kill existing
pkill -f "tsx index.ts" 2>/dev/null
pkill -f "next dev" 2>/dev/null
sleep 2

# Start chat service
cd /home/z/my-project/migo/mini-services/chat-service
npx tsx index.ts >> /tmp/chat.log 2>&1 &
echo $! > /tmp/chat.pid

sleep 3

# Start Next.js
cd /home/z/my-project/migo
npx next dev -p 3000 >> /tmp/next.log 2>&1 &
echo $! > /tmp/next.pid

echo "Started chat (PID: $(cat /tmp/chat.pid)) and next (PID: $(cat /tmp/next.pid))"
