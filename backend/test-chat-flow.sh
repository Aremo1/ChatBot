#!/bin/bash
set -euo pipefail

BACKEND=http://localhost:4000

echo "=== 1. Create two users ==="
TOKEN1=$(curl -s -X POST $BACKEND/api/local/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"user1@example.com","password":"verify1234","name":"User One"}')
echo "User 1 created: $TOKEN1"
TOKEN1=$(echo "$TOKEN1" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

TOKEN2=$(curl -s -X POST $BACKEND/api/local/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"user2@example.com","password":"verify1234","name":"User Two"}')
echo "User 2 created: $TOKEN2"
TOKEN2=$(echo "$TOKEN2" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

echo ""
echo "=== 2. Get users list ==="
curl -s http://localhost:4000/api/users -H "Authorization: Bearer $TOKEN1"

echo ""
echo "=== 3. Create chat between user1 and user2 ==="
curl -s -X POST $BACKEND/api/chats \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN1" \
  -d '{"userId":"1","otherUserId":"2"}'

echo ""
echo "=== 4. Get user1's chats ==="
curl -s http://localhost:4000/api/chats -H "Authorization: Bearer $TOKEN1"

echo ""
echo "=== 5. Send a message from user2 ==="
curl -s -X POST $BACKEND/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN2" \
  -d '{"chatId":"<placeholder>","content":"Hello from user2"}'
