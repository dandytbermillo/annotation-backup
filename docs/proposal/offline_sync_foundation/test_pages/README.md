# Offline Sync Foundation - Test Suite

## Overview
This directory contains comprehensive test pages, scripts, and validation tools for verifying the offline_sync_foundation implementation.

## Test Files Created

### 1. Manual Test Page (`offline-sync-smoke.md`)
- **Purpose**: Step-by-step manual testing checklist
- **Coverage**: Queue reliability, FTS, conflicts, platform-specific features
- **Usage**: Follow the checklist for manual validation during development

### 2. API Smoke Test Script (`../test_scripts/api-smoke-test.js`)
- **Purpose**: Automated API endpoint validation
- **Coverage**: All offline sync API endpoints (search, versions, queue export/import)
- **Usage**: 
  ```bash
  # Start dev server first
  npm run dev
  
  # Run API tests
  node docs/proposal/offline_sync_foundation/test_scripts/api-smoke-test.js
  ```

### 3. SQL Validation Snippets (`../test_scripts/sql-validation.sql`)
- **Purpose**: Database schema and data integrity checks
- **Coverage**: Schema validation, queue monitoring, performance metrics
- **Usage**:
  ```bash
  # Run all validations
  docker exec -i annotation_postgres psql -U postgres -d annotation_dev < docs/proposal/offline_sync_foundation/test_scripts/sql-validation.sql
  
  # Or copy specific queries to run individually
  ```

### 4. Integration Helper Script (`../test_scripts/integration-helper.sh`)
- **Purpose**: Automated test environment setup and teardown
- **Features**:
  - Database setup with migrations
  - Test data insertion
  - All test types execution
  - Queue monitoring
  - Cleanup utilities
- **Usage**:
  ```bash
  # Interactive mode
  ./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh
  
  # Command mode
  ./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh setup
  ./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh test all
  ./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh cleanup
  ```

### 5. Queue Reliability Test (`../test_scripts/test-queue-reliability.js`)
- **Purpose**: Comprehensive queue feature testing
- **Coverage**: Idempotency, priority, TTL, dead-letter, dependencies
- **Usage**:
  ```bash
  node docs/proposal/offline_sync_foundation/test_scripts/test-queue-reliability.js
  ```

### 6. Validation Script (`../test_scripts/validate-offline-sync.sh`)
- **Purpose**: Full implementation validation
- **Coverage**: Prerequisites, migrations, schema, APIs, components
- **Usage**:
  ```bash
  ./docs/proposal/offline_sync_foundation/test_scripts/validate-offline-sync.sh
  ```

## Quick Start Testing

### 1. Basic Validation
```bash
# Setup and validate everything
./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh setup
./docs/proposal/offline_sync_foundation/test_scripts/validate-offline-sync.sh
```

### 2. API Testing
```bash
# Start dev server
npm run dev

# Run API tests
node docs/proposal/offline_sync_foundation/test_scripts/api-smoke-test.js
```

### 3. Queue Testing
```bash
# Test queue reliability features
node docs/proposal/offline_sync_foundation/test_scripts/test-queue-reliability.js

# Monitor queue in real-time
./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh monitor
```

### 4. Manual Testing
- Open `offline-sync-smoke.md`
- Follow the test scenarios
- Mark each test as Pass/Fail
- Document any issues found

## Test Coverage Matrix

| Component | Manual | API | SQL | Integration | Queue |
|-----------|--------|-----|-----|------------|-------|
| Queue Reliability | ✓ | ✓ | ✓ | ✓ | ✓ |
| FTS Search | ✓ | ✓ | ✓ | ✓ | - |
| Conflict Detection | ✓ | - | ✓ | ✓ | - |
| Version History | ✓ | ✓ | ✓ | ✓ | - |
| Export/Import | ✓ | ✓ | - | ✓ | - |
| Platform Modes | ✓ | - | - | ✓ | - |
| Dead Letter | ✓ | - | ✓ | ✓ | ✓ |

## CI Integration

These tests can be integrated into CI pipelines:

```yaml
# Example GitHub Actions workflow
- name: Setup Database
  run: ./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh setup
  
- name: Run All Tests
  run: ./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh test all
  
- name: Validate Implementation
  run: ./docs/proposal/offline_sync_foundation/test_scripts/validate-offline-sync.sh
```

## Troubleshooting

### Common Issues

1. **PostgreSQL not running**
   ```bash
   docker compose up -d postgres
   ```

2. **Migrations not applied**
   ```bash
   ./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh reset
   ```

3. **Test data conflicts**
   ```bash
   ./docs/proposal/offline_sync_foundation/test_scripts/integration-helper.sh cleanup
   ```

4. **Port conflicts**
   - Check if port 3000 (Next.js) or 5432 (PostgreSQL) are in use
   - Stop conflicting services or change ports

## Next Steps

After successful testing:
1. Review test results in manual test page
2. Check performance metrics from SQL validations
3. Monitor queue processing in production
4. Set up automated CI/CD with these tests
5. Create additional test scenarios as needed