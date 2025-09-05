# Patches Index

This directory contains code patches generated during the Dark Mode feature implementation.

## Patch Naming Convention

Patches should be named using the format:
```
YYYY-MM-DD-<component>-<description>.patch
```

Example:
- `2025-09-05-theme-context-initial.patch`
- `2025-09-05-tailwind-config-dark-mode.patch`

## Current Patches

_No patches yet. Patches will be added as implementation progresses._

## How to Apply a Patch

```bash
# Apply a specific patch
git apply patches/YYYY-MM-DD-component-description.patch

# Test the patch without applying
git apply --check patches/YYYY-MM-DD-component-description.patch

# Apply with 3-way merge
git apply --3way patches/YYYY-MM-DD-component-description.patch
```

## Creating a Patch

```bash
# Create a patch from staged changes
git diff --cached > patches/YYYY-MM-DD-component-description.patch

# Create a patch from last commit
git format-patch -1 HEAD

# Create a patch from uncommitted changes
git diff > patches/YYYY-MM-DD-component-description.patch
```

---
Feature: dark_mode