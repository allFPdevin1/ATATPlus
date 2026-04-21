#!/bin/bash

# AutoRewardPlus - Microsoft Rewards
# Bash equivalent of start.bat

echo "========================================"
echo "  AutoRewardPlus - Microsoft Rewards"
echo "========================================"
echo ""

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js not found! Please install from https://nodejs.org"
    read -p "Press any key to exit..."
    exit 1
fi

# Always rebuild before running
echo "[INFO] Building project..."
npm run build
if [ $? -ne 0 ]; then
    echo "[ERROR] Build failed!"
    read -p "Press any key to exit..."
    exit 1
fi

# Run
echo ""
echo "[INFO] Starting bot..."
echo ""
node ./dist/index.js
echo ""
echo "========================================"
echo "  Bot finished. Press any key to close."
echo "========================================"
read -p ""
