# Documentation Process Guide Resources

This directory contains meta-documentation about the documentation process itself (as per Rule 6).

## Structure

```
docs/documentation_process_guide/
├── README.md                    # This file
├── archive/                     # Historical versions and plans
│   ├── DOCUMENTATION_GUIDE_V1.3_UPDATE_SUMMARY.md
│   └── DOCUMENTATION_GUIDE_V1.4_IMPROVEMENTS_PLAN.md
├── patches/                     # Patches for guide updates
│   ├── README.md
│   ├── 2025-09-03-rule8-patches-directory-v2.patch
│   └── 2025-09-03-rule8-patches-directory.patch
├── proposals/                   # Proposals for process improvements
│   └── META_DOCUMENTATION_PROPOSAL.md
└── META_DOCUMENTATION_PROPOSAL.md  # (to be moved to proposals/)
```

## Main Documentation

The main Documentation Process Guide remains at:
- `docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md` (v1.4.5)

This location is maintained for compatibility with existing references and workflows.

## Archive Contents

### V1.3 Update Summary
- Summary of changes from v1.2 to v1.3
- Historical reference for understanding evolution

### V1.4 Improvements Plan
- Completed plan for v1.4.0 through v1.4.5 updates
- Items 1-6, 8-9 successfully implemented
- Item 7 (LLM Safety) determined to belong in CLAUDE.md

## Patches

Available patches for applying updates to the Documentation Process Guide.

## Proposals

Proposals for future improvements to the documentation process.

## Rule 6: Process Documentation

As defined in the Documentation Process Guide v1.4.3:
> - Documentation about the documentation process goes in: `docs/documentation_process_guide/`
> - Documentation about specific features goes in: `docs/proposal/<feature>/`
> - The main Documentation Process Guide stays at `docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md` (for compatibility)
> - This rule ensures clean separation with minimal disruption
