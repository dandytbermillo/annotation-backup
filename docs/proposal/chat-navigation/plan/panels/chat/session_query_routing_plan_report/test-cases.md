# Action Query Routing Test Cases

## Prerequisites

1. Start the dev server: `npm run dev`
2. Open the application in browser
3. Open the chat panel

---

## Test Suite 1: Panel Open Tracking

### TC-1.1: Track Recent Panel Open
**Steps**:
1. In chat, type: "show recent" or "open recent"
2. Verify the Recent panel opens
3. In chat, type: "did I open recent?"

**Expected Result**:
```
Yes, you opened "Recent" this session.
```

### TC-1.2: Track Quick Links Panel Open
**Steps**:
1. In chat, type: "show quick links D"
2. Verify Quick Links D panel opens
3. In chat, type: "did I open quick links D?"

**Expected Result**:
```
Yes, you opened "Quick Links D" this session.
```

### TC-1.3: Panel Name Normalization
**Steps**:
1. Open Quick Links A via chat
2. Ask: "did I open links a?"

**Expected Result**:
```
Yes, you opened "Quick Links A" this session.
```
(Normalizes "links a" to "Quick Links A")

### TC-1.4: Negative Panel Query
**Steps**:
1. Do NOT open any panels
2. Ask: "did I open recent?"

**Expected Result**:
```
No, I have no record of opening "Recent" this session.
```

---

## Test Suite 2: Workspace Action Tracking

### TC-2.1: Track Workspace Open
**Steps**:
1. In chat, type: "open workspace 6"
2. Verify workspace 6 opens
3. In chat, type: "did I open workspace 6?"

**Expected Result**:
```
Yes, you opened workspace "Workspace 6" this session.
```

### TC-2.2: Track Workspace Rename
**Steps**:
1. In chat, type: "rename workspace 5 to Sprint 5"
2. Verify rename completes
3. In chat, type: "did I rename Sprint 5?"

**Expected Result**:
```
Yes, you renamed a workspace to "Sprint 5" this session.
```

### TC-2.3: Track Workspace Create
**Steps**:
1. In chat, type: "create workspace Test123"
2. Verify workspace is created
3. In chat, type: "did I create workspace Test123?"

**Expected Result**:
```
Yes, you created workspace "Test123" this session.
```

### TC-2.4: Track Workspace Delete
**Steps**:
1. In chat, type: "delete workspace Test123"
2. Confirm deletion
3. In chat, type: "did I delete workspace Test123?"

**Expected Result**:
```
Yes, you deleted workspace "Test123" this session.
```

---

## Test Suite 3: Entry/Navigation Tracking

### TC-3.1: Track Entry Open
**Steps**:
1. In chat, type: "open summary14" (or another entry name)
2. Verify entry opens
3. In chat, type: "did I open summary14?"

**Expected Result**:
```
Yes, you opened entry "summary14" this session.
```

### TC-3.2: Track Go Home
**Steps**:
1. In chat, type: "go home"
2. Verify navigation to Home
3. In chat, type: "did I go home?"

**Expected Result**:
```
Yes, you went home this session.
```

---

## Test Suite 4: Multiple Actions & History

### TC-4.1: Multiple Panel Opens
**Steps**:
1. Open Recent panel via chat
2. Open Quick Links A via chat
3. Open Quick Links D via chat
4. Ask: "did I open recent?"

**Expected Result**:
```
Yes, you opened "Recent" this session.
```
(Should find it in history even though it wasn't the last action)

### TC-4.2: Wrong Panel Query
**Steps**:
1. Open Recent panel only
2. Ask: "did I open quick links D?"

**Expected Result**:
```
No, I have no record of opening "Quick Links D" this session. You opened "Recent".
```

### TC-4.3: List All Opened Panels
**Steps**:
1. Open Recent, Quick Links A, and Quick Links D
2. Ask: "did I open any panels?"

**Expected Result**:
```
Yes, you opened panels this session: Recent, Quick Links A, Quick Links D.
```

---

## Test Suite 5: Edge Cases

### TC-5.1: Case Insensitive Matching
**Steps**:
1. Open workspace "Marketing"
2. Ask: "did I open workspace MARKETING?"

**Expected Result**:
```
Yes, you opened workspace "Marketing" this session.
```

### TC-5.2: Fresh Session (No Actions)
**Steps**:
1. Refresh the page (clear session)
2. Immediately ask: "did I open workspace 6?"

**Expected Result**:
```
No, I have no record of opening workspace "6" this session.
```

### TC-5.3: "Just" Modifier (Last Action Only)
**Steps**:
1. Open workspace 6
2. Open workspace 7
3. Ask: "did I just open workspace 6?"

**Expected Result**:
```
No, your last action was opening workspace "Workspace 7".
```

---

## Test Execution Log

| Test ID | Date | Tester | Result | Notes |
|---------|------|--------|--------|-------|
| TC-1.1 | | | | |
| TC-1.2 | | | | |
| TC-1.3 | | | | |
| TC-1.4 | | | | |
| TC-2.1 | | | | |
| TC-2.2 | | | | |
| TC-2.3 | | | | |
| TC-2.4 | | | | |
| TC-3.1 | | | | |
| TC-3.2 | | | | |
| TC-4.1 | | | | |
| TC-4.2 | | | | |
| TC-4.3 | | | | |
| TC-5.1 | | | | |
| TC-5.2 | | | | |
| TC-5.3 | | | | |

---

## Regression Tests

Ensure existing functionality still works:

- [ ] "open workspace 6" still opens the workspace
- [ ] "show quick links" still shows the panel
- [ ] "what did I just do?" still returns last action
- [ ] "where am I?" still returns location info
- [ ] Session state persists across page refreshes
