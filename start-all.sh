#!/bin/bash
# Kill any existing instances
pkill -f "next dev -p 3000" 2>/dev/null
pkill -f "chat-service/index" 2>/dev/null
sleep 2

# Start chat service
cd /home/z/my-project/mini-services/chat-service
node index.ts > log.txt 2>&1 &
echo "Chat service started on port 3003"

# Start Next.js
cd /home/z/my-project
exec node node_modules/.bin/next dev -p 3000 --webpack
