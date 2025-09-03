#!/usr/bin/env node

const { spawn, exec } = require('child_process');
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
  info: (msg) => console.log(`${colors.green}${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}${msg}${colors.reset}`),
  error: (msg) => console.error(`${colors.red}${msg}${colors.reset}`)
};

// Check if Docker is running
async function isDockerRunning() {
  try {
    await execAsync('docker info');
    return true;
  } catch {
    return false;
  }
}

// Start Docker on macOS
async function startDocker() {
  const isMac = process.platform === 'darwin';
  
  if (!isMac) {
    log.error('Automatic Docker start is only supported on macOS. Please start Docker manually.');
    process.exit(1);
  }
  
  log.warn('Docker is not running. Starting Docker...');
  
  try {
    await execAsync('open -a Docker');
    
    // Wait for Docker to start
    log.warn('Waiting for Docker to start...');
    const maxAttempts = 30;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      if (await isDockerRunning()) {
        log.info('Docker started successfully!');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      process.stdout.write('.');
      attempts++;
    }
    
    throw new Error('Docker failed to start within 60 seconds');
  } catch (error) {
    log.error(error.message);
    process.exit(1);
  }
}

// Check if PostgreSQL container is running
async function isPostgresRunning() {
  try {
    const { stdout } = await execAsync('docker-compose ps postgres');
    return stdout.includes('Up');
  } catch {
    return false;
  }
}

// Start PostgreSQL container
async function startPostgres() {
  log.warn('Starting PostgreSQL container...');
  
  try {
    await execAsync('docker-compose up -d postgres');
    
    // Wait for PostgreSQL to be ready
    log.warn('Waiting for PostgreSQL to be ready...');
    const maxAttempts = 30;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        await execAsync('docker-compose exec -T postgres pg_isready -U postgres');
        log.info('PostgreSQL is ready!');
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 2000));
        process.stdout.write('.');
        attempts++;
      }
    }
    
    throw new Error('PostgreSQL failed to start within 60 seconds');
  } catch (error) {
    log.error(error.message);
    process.exit(1);
  }
}

// Run database migrations
async function runMigrations() {
  const fs = require('fs');
  
  if (fs.existsSync('scripts/run-migrations.js')) {
    log.warn('Running database migrations...');
    try {
      const { spawn } = require('child_process');
      await new Promise((resolve, reject) => {
        const migrate = spawn('node', ['scripts/run-migrations.js'], {
          stdio: 'inherit'
        });
        migrate.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`Migration failed with code ${code}`));
        });
      });
      log.info('Migrations completed successfully!');
    } catch (error) {
      log.error(`Migration failed: ${error.message}`);
      // Continue anyway - migrations might already be applied
    }
  }
}

// Start Next.js dev server
function startNextDev() {
  log.info('Starting Next.js development server...');
  
  const next = spawn('npx', ['next', 'dev'], {
    stdio: 'inherit',
    shell: true
  });
  
  next.on('error', (error) => {
    log.error(`Failed to start Next.js: ${error.message}`);
    process.exit(1);
  });
  
  // Handle process termination
  process.on('SIGINT', () => {
    next.kill('SIGINT');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    next.kill('SIGTERM');
    process.exit(0);
  });
}

// Main function
async function main() {
  log.info('Starting development environment...');
  
  // Check and start Docker if needed
  if (!(await isDockerRunning())) {
    await startDocker();
  } else {
    log.info('Docker is already running');
  }
  
  // Check and start PostgreSQL if needed
  if (!(await isPostgresRunning())) {
    await startPostgres();
  } else {
    log.info('PostgreSQL container is already running');
  }
  
  // Run migrations
  await runMigrations();
  
  // Start Next.js
  startNextDev();
}

// Run the main function
main().catch((error) => {
  log.error(`Failed to start development environment: ${error.message}`);
  process.exit(1);
});