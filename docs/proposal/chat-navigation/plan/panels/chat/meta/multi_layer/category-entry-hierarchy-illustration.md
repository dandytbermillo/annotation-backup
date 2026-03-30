# Category → Entry → Dashboard/Workspace Hierarchy — Full Illustration

This document shows the complete structural hierarchy of the annotation system, from categories down to individual widgets and content.

---

## Complete Hierarchy

```
🏛️ ANNOTATION SYSTEM
│
├── 👤 Personal (category)
│     │
│     ├── 🏠 Main Dashboard (no workspaces — overview only)
│     │     ├── 🕐 Recent ──────────────── shows recent Personal entries
│     │     ├── 🔗 Links Panel A ────────── links to Personal entries (journal, health tracker, recipes)
│     │     ├── ⚙️ Widget Manager ────────── manage dashboard widgets
│     │     ├── ▶ Continue ──────────────── resume last visited workspace
│     │     └── 📂 Navigator ────────────── browse all Personal entries
│     │
│     ├── 📂 journal (entry — has dashboard + workspaces)
│     │     │
│     │     ├── 🏠 Dashboard (entry-level — default view when opening this entry)
│     │     │     ├── 🕐 Recent ────────────── recent items in this entry
│     │     │     ├── 🔗 Links Panel A ──────── links to notes, other entries
│     │     │     ├── 🔗 Links Panel B ──────── more links (duplicable widget)
│     │     │     ├── ⚙️ Widget Manager
│     │     │     ├── ▶ Continue
│     │     │     ├── 📂 Navigator ──────────── browse notes/workspaces in this entry
│     │     │     └── ✏️ Quick Capture ────────── quick note capture
│     │     │
│     │     ├── 📝 Workspace: Daily Log
│     │     │     ├── 📄 Note: "March 29 Entry" ──── TipTap editor document
│     │     │     │     ├── 📝 Text content
│     │     │     │     ├── 🖼️ Embedded image (asset)
│     │     │     │     └── 📎 Attached file (asset)
│     │     │     ├── 📄 Note: "March 28 Entry"
│     │     │     └── 🧮 Calculator Widget
│     │     │
│     │     └── 📝 Workspace: Reflections
│     │           ├── 📄 Note: "Weekly Review"
│     │           └── 📄 Note: "Monthly Goals"
│     │
│     ├── 📂 health tracker (entry)
│     │     │
│     │     ├── 🏠 Dashboard
│     │     │     ├── 🕐 Recent
│     │     │     ├── 🔗 Links Panel A
│     │     │     ├── ⚙️ Widget Manager
│     │     │     ├── ▶ Continue
│     │     │     └── 📂 Navigator
│     │     │
│     │     ├── 📝 Workspace: Fitness
│     │     │     ├── 📄 Note: "Workout Plan"
│     │     │     ├── 📄 Note: "Progress Photos"
│     │     │     │     └── 🖼️ Image assets (before/after photos)
│     │     │     └── 🧮 Calculator Widget (BMI, calories)
│     │     │
│     │     └── 📝 Workspace: Nutrition
│     │           ├── 📄 Note: "Meal Plan"
│     │           └── 📄 Note: "Grocery List"
│     │
│     └── 📂 recipes (entry)
│           │
│           ├── 🏠 Dashboard
│           │     ├── 🕐 Recent
│           │     ├── 🔗 Links Panel A
│           │     └── 📂 Navigator
│           │
│           ├── 📝 Workspace: Italian
│           │     ├── 📄 Note: "Pasta Carbonara"
│           │     │     ├── 📝 Recipe text
│           │     │     └── 🖼️ Photo of dish
│           │     └── 📄 Note: "Risotto"
│           │
│           └── 📝 Workspace: Asian
│                 ├── 📄 Note: "Pad Thai"
│                 └── 📄 Note: "Ramen"
│
├── 💼 Business (category)
│     │
│     ├── 🏠 Main Dashboard (no workspaces)
│     │     ├── 🕐 Recent ──────────────── shows recent Business entries
│     │     ├── 🔗 Links Panel A ────────── links to Business entries
│     │     ├── ⚙️ Widget Manager
│     │     ├── ▶ Continue
│     │     └── 📂 Navigator ────────────── browse all Business entries
│     │
│     ├── 📂 invoices (entry)
│     │     │
│     │     ├── 🏠 Dashboard
│     │     │     ├── 🕐 Recent
│     │     │     ├── 🔗 Links Panel A ──── links to invoice notes
│     │     │     ├── 🔗 Links Panel B ──── links to client entries
│     │     │     ├── ⚙️ Widget Manager
│     │     │     └── 📂 Navigator
│     │     │
│     │     ├── 📝 Workspace: Q1 2026
│     │     │     ├── 📄 Note: "Invoice #001 - Client Alpha"
│     │     │     │     └── 📎 Attached PDF (invoice file)
│     │     │     ├── 📄 Note: "Invoice #002 - Client Beta"
│     │     │     │     └── 📎 Attached PDF
│     │     │     └── 🧮 Calculator Widget (totals, tax)
│     │     │
│     │     └── 📝 Workspace: Q2 2026
│     │           ├── 📄 Note: "Invoice #003"
│     │           └── 📄 Note: "Invoice #004"
│     │
│     └── 📂 clients (entry)
│           │
│           ├── 🏠 Dashboard
│           │     ├── 🕐 Recent
│           │     ├── 🔗 Links Panel A ──── links to client-specific notes
│           │     ├── ⚙️ Widget Manager
│           │     └── 📂 Navigator
│           │
│           ├── 📝 Workspace: Client Alpha
│           │     ├── 📄 Note: "Contract Details"
│           │     │     └── 📎 Contract PDF
│           │     ├── 📄 Note: "Meeting Notes"
│           │     └── 📄 Note: "Project Scope"
│           │
│           └── 📝 Workspace: Client Beta
│                 ├── 📄 Note: "Proposal"
│                 └── 📄 Note: "Communication Log"
│
└── 🚀 Project (category)
      │
      ├── 🏠 Main Dashboard (no workspaces)
      │     ├── 🕐 Recent ──────────────── shows recent Project entries
      │     ├── 🔗 Links Panel A ────────── links to Project entries
      │     ├── 🔗 Links Panel B ────────── links to related Business entries (cross-category)
      │     ├── ⚙️ Widget Manager
      │     ├── ▶ Continue
      │     └── 📂 Navigator ────────────── browse all Project entries
      │
      ├── 📂 budget100 (entry)
      │     │
      │     ├── 🏠 Dashboard
      │     │     ├── 🕐 Recent
      │     │     ├── 🔗 Links Panel A ──── links to budget notes
      │     │     ├── 🔗 Links Panel B ──── links to related entries (budget200, invoices)
      │     │     ├── ⚙️ Widget Manager
      │     │     ├── ▶ Continue
      │     │     ├── 📂 Navigator A ────── browse this entry (duplicable)
      │     │     ├── 📂 Navigator B ────── second navigator view
      │     │     └── ✏️ Quick Capture
      │     │
      │     ├── 📝 Workspace: Planning
      │     │     ├── 📄 Note: "Main Document" ──── primary project document
      │     │     │     ├── 📝 Rich text content (TipTap editor)
      │     │     │     ├── 🖼️ Embedded diagram image
      │     │     │     └── 📎 Attached spreadsheet
      │     │     ├── 📄 Note: "Budget Breakdown"
      │     │     │     └── 📝 Text + tables
      │     │     └── 🧮 Calculator Widget
      │     │
      │     ├── 📝 Workspace: Research
      │     │     ├── 📄 Note: "Market Analysis"
      │     │     ├── 📄 Note: "Competitor Review"
      │     │     │     └── 🖼️ Screenshot comparisons
      │     │     └── 📄 Note: "Data Sources"
      │     │           └── 📎 CSV data file
      │     │
      │     └── 📝 Workspace: Archive
      │           ├── 📄 Note: "Old Proposals"
      │           └── 📄 Note: "Deprecated Plans"
      │
      └── 📂 budget200 (entry)
            │
            ├── 🏠 Dashboard
            │     ├── 🕐 Recent
            │     ├── 🔗 Links Panel A
            │     ├── ⚙️ Widget Manager
            │     └── 📂 Navigator
            │
            ├── 📝 Workspace: Execution
            │     ├── 📄 Note: "Implementation Plan"
            │     ├── 📄 Note: "Timeline"
            │     └── 🧮 Calculator Widget
            │
            └── 📝 Workspace: Reporting
                  ├── 📄 Note: "Monthly Report"
                  └── 📄 Note: "Final Summary"
```

---

## Structural Rules

| Level | Name | Contains | Dashboard? | Workspaces? |
|-------|------|----------|------------|-------------|
| Top | Category (Personal, Business, Project) | Main Dashboard + Entries | Yes (main dashboard) | No |
| Middle | Entry (journal, budget100, clients) | Dashboard + Workspaces | Yes (entry dashboard) | Yes (1 or more) |
| Inner | Workspace (Planning, Q1 2026, Daily Log) | Widgets (Notes, Calculator, etc.) | No | N/A |

---

## Widget Types Available on Dashboards

| Widget | Icon | Singleton? | Duplicable? | Purpose |
|--------|------|------------|-------------|---------|
| Recent | 🕐 | Yes | No | Shows recently accessed items |
| Links Panel | 🔗 | No | Yes (A, B, C...) | Links to notes, entries, external resources |
| Widget Manager | ⚙️ | Yes | No | Manage/hide/show dashboard widgets |
| Continue | ▶ | Yes | No | Resume last visited workspace |
| Navigator | 📂 | No | Yes (A, B, C...) | Browse entries/notes/workspaces |
| Quick Capture | ✏️ | No | No | Quick note entry |

---

## Content Types Inside Workspaces

| Content | Icon | What it is |
|---------|------|------------|
| Note | 📄 | TipTap editor document — primary content unit |
| Text | 📝 | Rich text inside a note |
| Image | 🖼️ | Embedded image inside a note (asset) |
| File | 📎 | Attached file inside a note (PDF, CSV, etc.) |
| Calculator | 🧮 | Calculator widget (standalone in workspace) |

---

## Cross-Category Linking

Links Panel widgets can link across categories:

```
📂 budget100 (Project)
  └── 🔗 Links Panel B
        ├── → 📂 invoices (Business)     ← cross-category link
        ├── → 📂 budget200 (Project)     ← same-category link
        └── → 📄 "Contract" in clients   ← link to specific note
```

This allows users to connect related work across Personal, Business, and Project boundaries without moving content.

---

## Navigation Model

```
Category Switcher (far left or top)
    │
    ▼
Category Main Dashboard ── overview of all entries in this category
    │
    ▼ (click an entry)
Entry Dashboard ── overview of this entry's workspaces and widgets
    │
    ▼ (open a workspace)
Workspace ── work area with notes and widgets
    │
    ▼ (open a note)
Note Editor ── TipTap document with text, images, files
```

Each level has its own breadcrumb trail:
- `Personal > journal > Daily Log > March 29 Entry`
- `Project > budget100 > Planning > Main Document`
