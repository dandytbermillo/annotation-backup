#!/usr/bin/env node

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Colors for console output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

const log = {
  info: (msg) => console.log(`${colors.green}✓ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`),
  error: (msg) => console.error(`${colors.red}✗ ${msg}${colors.reset}`)
};

async function checkDocker() {
  try {
    await execAsync('docker info');
    log.info('Docker is running');
    return true;
  } catch {
    log.error('Docker is not running');
    console.log(`
Please start Docker manually:
  • On macOS: Open Docker.app or run 'open -a Docker'
  • On Linux: Run 'sudo systemctl start docker'
  • On Windows: Start Docker Desktop
`);
    return false;
  }
}

async function checkPostgres() {
  try {
    const { stdout } = await execAsync('docker-compose ps postgres');
    if (stdout.includes('Up')) {
      log.info('PostgreSQL container is running');
      return true;
    }
  } catch {
    // Container might not exist yet
  }
  
  log.warn('PostgreSQL container is not running');
  console.log(`
To start PostgreSQL:
  docker-compose up -d postgres
`);
  return false;
}

async function main() {
  console.log('\nChecking development environment...\n');
  
  const dockerOk = await checkDocker();
  if (!dockerOk) {
    process.exit(1);
  }
  
  const postgresOk = await checkPostgres();
  if (!postgresOk) {
    console.log('Run the following command to start PostgreSQL:');
    console.log('  docker-compose up -d postgres\n');
    process.exit(1);
  }
  
  console.log('\n✅ All services are running! You can now use npm run dev:next\n');
}

main().catch((error) => {
  log.error(`Error: ${error.message}`);
  process.exit(1);
});