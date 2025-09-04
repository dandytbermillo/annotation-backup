# Command Scripts

This directory contains executable scripts for development and testing workflows.

## Available Commands

### `generate-prp.md`
Generates a comprehensive PRP (Project Requirements Plan) for feature implementation.
- Performs codebase research
- Includes external documentation references
- Creates implementation blueprint with validation gates

### `execute-prp.md`
Executes a PRP file to implement the specified feature.
- Loads and validates the PRP
- Implements the code changes
- Runs validation gates

### `test-sync.sh`
Tests multi-client YJS synchronization with PostgreSQL persistence.
- Spins up 3 concurrent clients
- Verifies real-time annotation sync
- Confirms PostgreSQL persistence
```bash
./.claude/commands/test-sync.sh
```

### `validate-persistence.sh`
Validates PostgreSQL adapter implementation.
- Tests CRUD operations
- Verifies YJS state serialization
- Checks data integrity constraints
- Measures query performance
```bash
./.claude/commands/validate-persistence.sh
```

## Usage

Make scripts executable:
```bash
chmod +x .claude/commands/*.sh
```

Run scripts:
```bash
# Test scripts
./.claude/commands/test-sync.sh
./.claude/commands/validate-persistence.sh

# PRP commands (via Claude)
/generate-prp INITIAL.md
/execute-prp PRPs/postgres-migration.md
```