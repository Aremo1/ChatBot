#!/bin/bash
set -euo pipefail

BACKEND=http://localhost:4000

echo "=== SIGNIN ALICE ==="
TOKEN_ALICE=$(curl -s -X POST $BACKEND/api/local/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"alice2@example.com","password":"securepass1"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "Alice token length: ${#TOKEN_ALICE}"

echo ""
echo "=== SIGNIN BOB ==="
TOKEN_BOB=$(curl -s -X POST $BACKEND/api/local/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"bob3@example.com","password":"securepass2"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "Bob token length: ${#TOKEN_BOB}"

echo ""
echo "=== CREATE CHAT BETWEEN ALICE(4) AND BOB(5) ==="
CHAT_RESPONSE=$(curl -s -X POST $BACKEND/api/chats \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_ALICE" \
  -d '{"userId":"4","otherUserId":"5"}')
echo "$CHAT_RESPONSE"
CHAT_ID=$(echo "$CHAT_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Chat ID: $CHAT_ID"

echo ""
echo "=== GET ALICE'S CHATS ==="
curl -s $BACKEND/api/chats -H "Authorization: Bearer $TOKEN_ALICE"

echo ""
echo "=== CREATE CHAT FROM BOB (5) TO ALICE (4) ==="
curl -s -X POST $BACKEND/api/chats \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_BOB" \
  -d '{"userId":"5","otherUserId":"4"}'
echo ""
