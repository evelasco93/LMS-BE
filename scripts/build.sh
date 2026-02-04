#!/bin/bash

# Build Script
# Compiles TypeScript code for both CDK and Lambda handler

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Building TypeScript project...${NC}"

# Change to project root
cd "$(dirname "$0")/.."

# Clean dist directory
echo -e "${YELLOW}Cleaning dist directory...${NC}"
rm -rf dist
mkdir -p dist/handler

# Build TypeScript
echo -e "${YELLOW}Compiling TypeScript...${NC}"
npx tsc -p tsconfig.handler.json

# Copy package.json for Lambda
echo -e "${YELLOW}Creating Lambda package.json...${NC}"
cat > dist/handler/package.json << 'EOF'
{
  "name": "lead-intake-handler",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.450.0",
    "@aws-sdk/lib-dynamodb": "^3.450.0",
    "aws-sdk": "^2.1691.0",
    "inversify": "^6.0.2",
    "reflect-metadata": "^0.2.2",
    "ts-lambda-api": "^0.7.1",
    "axios": "^1.6.0",
    "uuid": "^9.0.0"
  }
}
EOF

# Install production dependencies in dist/handler
echo -e "${YELLOW}Installing Lambda dependencies...${NC}"
cd dist/handler
npm install --production --no-package-lock
cd ../..

echo -e "${GREEN}Build complete!${NC}"
echo -e "${GREEN}Lambda package ready at: dist/handler${NC}"
