#!/bin/bash
# Rhosam ChatBot - Start both backend and frontend servers

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Rhosam ChatBot - Development Server${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed. Please install Node.js first.${NC}"
    exit 1
fi

# Check Node version
NODE_VERSION=$(node -v)
echo -e "${GREEN}Node.js version: $(node -v)${NC}"
echo ""

# Check if backend dependencies are installed
if [ ! -d "backend/node_modules" ]; then
    echo -e "${YELLOW}Installing backend dependencies...${NC}"
    cd backend
    npm install
    cd ..
fi

# Check if frontend dependencies are installed
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    cd frontend
    npm install
    cd ..
fi

echo -e "${GREEN}Starting servers...${NC}"
echo ""

# Start backend in background
echo -e "${BLUE}Starting backend server on http://localhost:4000${NC}"
cd backend
npm run dev &
BACKEND_PID=$!
echo "  Backend PID: $BACKEND_PID"

# Start frontend in background
echo -e "${BLUE}Starting frontend server on http://localhost:5173${NC}"
cd ../frontend
npm run dev &
FRONTEND_PID=$!
echo "  Frontend PID: $FRONTEND_PID"

echo ""
echo -e "${GREEN}Development servers running!${NC}"
echo -e "  Frontend: http://localhost:5173"
echo -e "  Backend:  http://localhost:4000"
echo ""
echo "Press Ctrl+C to stop all servers."
echo ""

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID

# Cleanup on exit
echo -e "\n${YELLOW}Stopping servers...${NC}"
kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
wait
echo -e "${GREEN}All servers stopped.${NC}"
