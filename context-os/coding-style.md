# Context-OS Coding Style Guide

**Version**: 1.0.0  
**Last Updated**: 2025-09-03

## TypeScript/JavaScript Style

### General Principles
- **Clarity over cleverness** - Write code that is easy to understand
- **Explicit over implicit** - Be explicit about types and intentions
- **Consistent formatting** - Use Prettier for automatic formatting
- **Meaningful names** - Variables and functions should be self-documenting

### Naming Conventions

#### Files
```typescript
// TypeScript files: kebab-case
plan-filler.ts
doc-writer.ts

// Test files: same name with .test or .spec
plan-filler.test.ts
doc-writer.spec.ts

// Type definition files: types suffix
agent.types.ts
validation.types.ts
```

#### Variables & Functions
```typescript
// Variables: camelCase
const featureSlug = 'my_feature';
const isValid = true;

// Functions: camelCase, verb prefix
function validatePlan(plan: Plan): ValidationResult {}
function createFeature(description: string): Promise<void> {}

// Constants: UPPER_SNAKE_CASE
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 5000;

// Classes: PascalCase
class Orchestrator {}
class PlanFillerAgent {}

// Interfaces/Types: PascalCase, I prefix for interfaces
interface IAgent {}
type FeaturePlan = {}
```

### TypeScript Specific

#### Type Annotations
```typescript
// Always use explicit return types
function proposeSlug(description: string): string {
  return description.toLowerCase().replace(/\s+/g, '_');
}

// Use interfaces for objects
interface FeatureConfig {
  slug: string;
  status: Status;
  objective: string;
}

// Use enums for fixed values
enum Status {
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETE = 'COMPLETE'
}
```

#### Async/Await
```typescript
// Prefer async/await over promises
async function createFeature(slug: string): Promise<void> {
  try {
    await validateSlug(slug);
    await createDirectories(slug);
  } catch (error) {
    handleError(error);
  }
}

// Not this:
function createFeature(slug: string): Promise<void> {
  return validateSlug(slug)
    .then(() => createDirectories(slug))
    .catch(handleError);
}
```

### Error Handling

```typescript
// Custom error classes
class ValidationError extends Error {
  constructor(message: string, public field: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Explicit error handling
try {
  await riskyOperation();
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(`Validation failed for ${error.field}: ${error.message}`);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Documentation

#### JSDoc Comments
```typescript
/**
 * Validates a feature plan against requirements
 * @param plan - The feature plan to validate
 * @returns Validation result with any errors
 * @throws {ValidationError} If plan structure is invalid
 */
function validatePlan(plan: FeaturePlan): ValidationResult {
  // Implementation
}
```

#### Inline Comments
```typescript
// Use comments to explain WHY, not WHAT
// Bad: Increment counter
counter++;

// Good: Retry up to MAX_RETRIES times to handle transient failures
counter++;
```

## File Organization

### Module Structure
```typescript
// 1. Imports (grouped and sorted)
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

import { validatePlan } from './validator';
import { FeaturePlan, ValidationResult } from './types';

// 2. Constants
const MAX_SLUG_LENGTH = 50;

// 3. Types/Interfaces (if not in separate file)
interface LocalType {
  // ...
}

// 4. Main class/function
export class Orchestrator {
  // ...
}

// 5. Helper functions
function helperFunction(): void {
  // ...
}

// 6. Exports (if not inline)
export { helperFunction };
```

### Class Organization
```typescript
class Agent {
  // 1. Static properties
  static readonly VERSION = '1.0.0';
  
  // 2. Instance properties
  private config: Config;
  
  // 3. Constructor
  constructor(config: Config) {
    this.config = config;
  }
  
  // 4. Public methods
  public async execute(): Promise<void> {
    // ...
  }
  
  // 5. Protected methods
  protected validate(): boolean {
    // ...
  }
  
  // 6. Private methods
  private cleanup(): void {
    // ...
  }
}
```

## Testing Style

### Test Structure
```typescript
describe('Orchestrator', () => {
  let orchestrator: Orchestrator;
  
  beforeEach(() => {
    orchestrator = new Orchestrator();
  });
  
  describe('proposeSlug', () => {
    it('should convert spaces to underscores', () => {
      const slug = orchestrator.proposeSlug('my feature');
      expect(slug).toBe('my_feature');
    });
    
    it('should handle special characters', () => {
      const slug = orchestrator.proposeSlug('my-feature!@#');
      expect(slug).toBe('my_feature');
    });
  });
});
```

### Test Naming
```typescript
// Use descriptive test names that explain the scenario
it('should return validation error when objective is missing', () => {});

// Not this:
it('should work', () => {});
it('test validation', () => {});
```

## CLI Output Style

### Color Usage
```typescript
import chalk from 'chalk';

// Success: Green
console.log(chalk.green('✓ Feature created successfully'));

// Warning: Yellow
console.log(chalk.yellow('⚠ Missing optional field'));

// Error: Red
console.log(chalk.red('✗ Validation failed'));

// Info: Blue
console.log(chalk.blue('→ Creating directories...'));

// Headers: Bold
console.log(chalk.bold('Feature Creation'));
```

### Output Formatting
```typescript
// Progress indicators
console.log('→ Validating plan...');
console.log('→ Creating directories...');
console.log('→ Writing files...');

// Success summary
console.log('\n✓ Feature created successfully!');
console.log(`  Location: ${path}`);
console.log(`  Files created: ${count}`);

// Error display
console.error('\n✗ Validation failed:');
errors.forEach(error => {
  console.error(`  - ${error.field}: ${error.message}`);
});
```

## Git Commit Style

### Commit Messages
```
type(scope): subject

body (optional)

footer (optional)
```

### Types
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation only
- **style**: Code style changes
- **refactor**: Code refactoring
- **test**: Test changes
- **chore**: Build process or auxiliary tool changes

### Examples
```bash
feat(orchestrator): add plan validation
fix(verifier): handle timeout correctly
docs(readme): update installation instructions
refactor(agents): extract common base class
```

## Code Quality Rules

### Linting Rules
```json
{
  "rules": {
    "no-console": "off",
    "no-unused-vars": "error",
    "prefer-const": "error",
    "no-var": "error",
    "@typescript-eslint/explicit-return-type": "warn",
    "@typescript-eslint/no-explicit-any": "error"
  }
}
```

### Complexity Limits
- Maximum function length: 50 lines
- Maximum file length: 300 lines
- Maximum cyclomatic complexity: 10
- Maximum nested callbacks: 3

## Security Practices

### Input Validation
```typescript
// Always validate user input
function validateSlug(slug: string): void {
  if (!/^[a-z0-9_-]+$/.test(slug)) {
    throw new ValidationError('Invalid slug format', 'slug');
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    throw new ValidationError('Slug too long', 'slug');
  }
}
```

### Path Safety
```typescript
// Prevent path traversal
function safePath(basePath: string, userPath: string): string {
  const resolved = path.resolve(basePath, userPath);
  if (!resolved.startsWith(path.resolve(basePath))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}
```

---

**Note**: This style guide should be enforced through ESLint and Prettier configurations. All code must pass linting before merge.