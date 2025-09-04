# Context-OS - Intelligent Documentation Orchestrator

**Version**: 1.0.0  
**Purpose**: Automated feature documentation scaffolding and compliance enforcement

## 🚀 Quick Start

### Step 1: Create Your Feature Plan

```bash
# Copy the template
cp context-os/templates/INITIAL.md context-os/drafts/my-feature.md

# Edit with your feature details
vim context-os/drafts/my-feature.md
```

### Step 2: Create Feature Structure

```bash
# Run Context-OS to create compliant structure
node context-os/create-feature.js "My Feature Title" context-os/drafts/my-feature.md

# Or use the interactive mode (will prompt for missing info)
node context-os/create-feature.js "My Feature Title"
```

### Step 3: Validate Compliance

```bash
# Check that structure follows Documentation Process Guide
./scripts/validate-doc-structure.sh
```

## 📋 How It Works

Context-OS ensures your feature documentation follows the Documentation Process Guide v1.4.5:

1. **Validates** your feature plan (INITIAL.md) for required fields
2. **Prompts** for any missing information
3. **Creates** the complete directory structure
4. **Generates** starter templates for all required documents
5. **Enforces** compliance with validation checks

## 🎯 Workflow

### For New Features

```mermaid
User creates INITIAL.md
    ↓
Context-OS validates plan
    ↓
Missing fields? → Interactive filling
    ↓
User confirms creation
    ↓
Structure scaffolded at docs/proposal/<feature_slug>/
    ↓
Ready for implementation
```

### Required Fields in INITIAL.md

- **Title**: Feature name
- **Objective**: Clear goal (1-2 sentences)
- **Acceptance Criteria**: Measurable checklist
- **Implementation Tasks**: Specific action items

### Generated Structure

```
docs/proposal/<feature_slug>/
├── implementation.md              # Your plan (from INITIAL.md)
├── reports/
│   └── <slug>-Implementation-Report.md
├── implementation-details/
│   └── artifacts/
│       └── INDEX.md
├── post-implementation-fixes/
│   ├── README.md                 # Mandatory index
│   ├── critical/
│   ├── high/
│   ├── medium/
│   └── low/
└── patches/
    └── README.md
```

## 🤖 Agents

Context-OS uses specialized agents for different tasks:

| Agent | Purpose | When Used |
|-------|---------|-----------|
| **Orchestrator** | Main coordinator | Always |
| **PlanFillerAgent** | Completes missing fields | When plan incomplete |
| **VerifierAgent** | Runs tests | During testing phase |
| **ClassifierAgent** | Assigns severity | For bug fixes |
| **DocWriterAgent** | Generates docs | Post-implementation |

## 📝 Example Usage

### Basic Feature Creation

```bash
# 1. Create your plan
cat > context-os/drafts/user-auth.md << EOF
# User Authentication

## Objective
Add secure user login with JWT tokens

## Acceptance Criteria
- [ ] Users can register
- [ ] Users can login
- [ ] Sessions expire after 24h

## Implementation Tasks
- [ ] Create auth endpoints
- [ ] Add JWT middleware
- [ ] Write tests
EOF

# 2. Create feature structure
node context-os/create-feature.js "User Authentication" context-os/drafts/user-auth.md

# 3. Start working
cd docs/proposal/user_authentication
vim implementation-details/auth-design.md
```

### Interactive Mode

```bash
# Let Context-OS guide you
node context-os/create-feature.js "Payment Integration"

# Context-OS will prompt:
# > What is the main goal? 
# > Enter acceptance criteria (empty line to finish):
# > Enter implementation tasks:
# etc.
```

## 🔧 Commands

### Create Feature
```bash
node context-os/create-feature.js "<title>" [draft-path]
```

### Validate Structure
```bash
./scripts/validate-doc-structure.sh [--strict]
```

### Check Status
```bash
grep "Status:" docs/proposal/*/implementation.md
```

## ⚙️ Configuration

### Environment Variables
```bash
# Optional: Change default paths
export CONTEXT_OS_DRAFTS_DIR="my-drafts/"
export CONTEXT_OS_FEATURES_DIR="docs/my-features/"
```

### Package.json Scripts
```json
{
  "scripts": {
    "feature:new": "node context-os/create-feature.js",
    "feature:validate": "./scripts/validate-doc-structure.sh",
    "feature:list": "ls -la docs/proposal/"
  }
}
```

## 📊 Status Management

Features progress through these statuses:

| Status | Emoji | Meaning |
|--------|-------|---------|
| PLANNED | 📝 | Not started |
| IN PROGRESS | 🚧 | Active development |
| TESTING | 🧪 | Running tests |
| COMPLETE | ✅ | Implementation done |
| BLOCKED | ❌ | Needs help |

## 🚫 Stop Conditions

Context-OS will refuse to proceed if:
- Required fields are missing and user won't fill them
- User declines confirmation
- Feature already exists (unless --force)
- Invalid slug format
- Attempting to modify completed features incorrectly

## 🐛 Troubleshooting

### "Plan validation failed"
- Check that all required fields are filled
- Run in interactive mode to get prompted for missing info

### "Feature already exists"
- Use a different slug
- Or remove the existing feature first

### "Permission denied"
- Check file permissions
- Ensure you can write to docs/proposal/

## 📚 Documentation

- [Implementation Guide](./implementation.md) - How Context-OS works
- [Tech Stack](./tech-stack.md) - Technology choices
- [Coding Style](./coding-style.md) - Code conventions
- [Documentation Process Guide](../docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md) - The rules we enforce

## 🤝 Contributing

1. Follow the coding style guide
2. Add tests for new agents
3. Update documentation
4. Ensure validation passes

## 📄 License

Internal use only. See project LICENSE.

---

**Need help?** Run `node context-os/create-feature.js --help`