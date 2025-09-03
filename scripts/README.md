# Development Scripts

This directory contains scripts to help manage the development environment.

## Available Scripts

### `npm run dev` (Recommended)
**Automatically starts Docker and PostgreSQL before running Next.js**
- Checks if Docker is running, starts it if not (macOS only)
- Checks if PostgreSQL container is running, starts it if not
- Runs database migrations
- Starts Next.js development server

### `npm run dev:next`
**Runs only Next.js without checking dependencies**
- Use this if you've already started Docker and PostgreSQL manually
- Equivalent to the original `next dev`

### `npm run dev:check`
**Checks requirements before starting**
- Verifies Docker is running (but doesn't start it)
- Verifies PostgreSQL container is running
- If all checks pass, starts Next.js
- If checks fail, provides instructions

### `npm run dev:docker`
**Starts PostgreSQL then Next.js**
- Assumes Docker is already running
- Starts PostgreSQL container
- Starts Next.js development server

## Script Files

### `dev-with-docker.js`
Node.js script that automates the entire startup process:
1. Checks and starts Docker (macOS only)
2. Checks and starts PostgreSQL container
3. Runs database migrations
4. Starts Next.js dev server

### `dev-with-docker.sh`
Bash script alternative (macOS/Linux only) with same functionality.

### `check-docker.js`
Utility script that only checks if services are running without starting them.

## Usage Examples

### First time setup or after machine restart:
```bash
npm run dev
```
This will start everything automatically.

### If Docker is already running:
```bash
npm run dev:docker
```
This skips Docker check and just ensures PostgreSQL is running.

### If you prefer manual control:
```bash
# Terminal 1: Start Docker manually
open -a Docker  # macOS
# or use Docker Desktop

# Terminal 2: Start PostgreSQL
docker-compose up -d postgres

# Terminal 3: Start Next.js
npm run dev:next
```

### To check if everything is ready:
```bash
npm run dev:check
```

## Troubleshooting

### Docker won't start automatically
- Automatic Docker startup only works on macOS
- On Windows/Linux, start Docker manually then use `npm run dev:docker`

### PostgreSQL fails to start
- Check if port 5432 is already in use
- Check docker-compose.yml configuration
- Try `docker-compose down` then `docker-compose up -d postgres`

### Migration errors
- Check database connection in `.env`
- Ensure PostgreSQL is fully started before migrations run
- Run migrations manually: `npm run db:migrate`

## Environment Variables

Ensure your `.env` file has the correct PostgreSQL connection:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/annotation_dev
```