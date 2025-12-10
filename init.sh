#!/bin/bash
# =============================================================================
# init.sh - Development environment bootstrap for obsidian-github-tasks
# =============================================================================
# Run this at the start of each coding session to ensure consistent state.
#
# Usage: ./init.sh
# =============================================================================

set -e  # Exit on any error

echo "========================================"
echo "Initializing obsidian-github-tasks dev environment"
echo "========================================"

# Check we're in the right directory
if [ ! -f "package.json" ]; then
    echo "ERROR: Must run from repository root (package.json not found)"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
else
    echo "Dependencies already installed"
fi

# Clean previous build
if [ -d "dist" ]; then
    echo "Cleaning previous build..."
    rm -rf dist
fi

# Run build to verify everything compiles
echo "Running build..."
npm run build

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "BUILD SUCCESSFUL"
    echo "========================================"
    echo ""
    echo "Next steps:"
    echo "1. Read claude-progress.txt for session context"
    echo "2. Read feature_list.json to find next pending feature"
    echo "3. Run 'npm run dev' to start watch mode"
    echo ""
    echo "Key files:"
    echo "  - DESIGN_DOC.md: Technical design and architecture"
    echo "  - feature_list.json: Work queue with status tracking"
    echo "  - claude-progress.txt: Session log and handoff notes"
    echo ""
else
    echo ""
    echo "========================================"
    echo "BUILD FAILED - Fix errors before proceeding"
    echo "========================================"
    exit 1
fi
