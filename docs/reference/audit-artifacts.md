# Audit Artifacts (Phase 4 / 5 / 6)

The phase 4/5/6 audit artifact system is an opt-in, file-level audit trail that predates the current Witness implementation. It gives teams a separately-reviewable record — one file per concern — of which fields each broadcast event carries, what a valid test payload looks like, and which retained-slice assertions cover that event.

Gate #11 (`gate-audit-coverage`) enforces the system when any of the three files are present. If none exist, the gate skips silently. This means new projects that use only Witness files are unaffected.

---

## When it applies

- **Not present:** Gate #11 passes with `skipped: true`. No action required.
- **Any file present:** all three files are required and every broadcast event discovered by the runner must be covered in each one. A missing entry in any file is a hard error.

This all-or-nothing behaviour prevents partial adoption from silently hiding gaps.

---

## File locations

All three files live under `config.auditDir`, which defaults to `"witness"`:

```
${auditDir}/phase4-payload-continuity-audit.ts
${auditDir}/phase5-test-payloads.ts
${auditDir}/phase6-retained-slice-audit.ts
```

---

## Event discovery

Gate #11 discovers broadcast events using the same scan as Gate #2 and Gate #6 — it walks the broadcast files configured for the project and extracts every emitted event identifier. The resulting list is the authoritative set that all three audit files must cover.

---

## Phase 4: phase4-payload-continuity-audit.ts

**Purpose:** declares which fields each event's payload must contain (payload continuity audit).

### Expected format

```typescript
const REQUIRED_FIELDS: Record<string, string[]> = {
  "task.created": ["taskId", "title", "projectId", "clientTempId"],
  "task.updated": ["taskId", "title"],
  "task.deleted": ["taskId"],
};
```

### What Gate #11 checks

The gate extracts event names using the regex:

```
/"([a-z][a-z0-9._-]+\.[a-z][a-z0-9._-]*)"\s*:\s*\[/g
```

It matches the string key of each `REQUIRED_FIELDS` entry. A broadcast event that does not appear as a key is a violation:

> Event "task.created" has no REQUIRED_FIELDS entry in Phase 4. Add the projection-required fields.

---

## Phase 5: phase5-test-payloads.ts

**Purpose:** test payload trace coverage — one `publish()` call per event so that payloads can be replayed or inspected in isolation.

### Expected format

```typescript
publish("task.created", {
  taskId: "test-task-001",
  title: "Test Task",
  projectId: "test-project-001",
  clientTempId: null,
});
publish("task.updated", { taskId: "test-task-001", title: "Updated Title" });
publish("task.deleted", { taskId: "test-task-001" });
```

### What Gate #11 checks

The gate extracts event names using the regex:

```
/publish\s*\(\s*"([a-z][a-z0-9._-]+)"/g
```

It matches the first argument of every `publish()` call. A broadcast event that does not appear in any `publish()` call is a violation:

> Event "task.created" has no test payload in Phase 5. Add a publish() entry to the domain's payload array.

---

## Phase 6: phase6-retained-slice-audit.ts

**Purpose:** retained-field slice assertions — each event name must appear as a string literal, confirming that the retained-slice behaviour for that event has been considered.

### Expected format

```typescript
// Retained slice audit — each event name must appear as a string literal
"task.created";
"task.updated";
"task.deleted";
```

The gate does not require a particular expression form. The event name only needs to appear somewhere in the file as a double-quoted string literal, so it can equally appear inside an assertion helper, an object key, or a comment string — the check is purely textual.

### What Gate #11 checks

The gate extracts event names using the regex:

```
/"([a-z][a-z0-9-]*\.[a-z][a-z0-9._-]*)"/g
```

A broadcast event whose name does not match any string literal in the file is a violation:

> Event "task.created" is not referenced in Phase 6 retained slice audit. Add a lifecycle or signal assertion.

---

## Relationship to Witness

[Witness files](../guides/write-a-witness.md) (`*.witness.ts`) are the recommended approach for new projects. A witness provides programmatic Layer 3 proof — it imports the actual projection function and asserts that specific fields survive the transformation into the cache slice. Gate #12 enforces witness coverage.

The phase 4/5/6 files serve a different purpose: they are a file-level audit trail, human-readable and independently reviewable, that records intent rather than executing code. They are useful for teams that want an explicit, separately-tracked record of what fields each event carries and which events have been reviewed for retained-slice correctness.

The two systems are independent:

| System               | Gate     | What it proves                                                                                  |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `*.witness.ts` files | Gate #12 | Fields survive the projection into cache (runtime assertion)                                    |
| phase4/5/6 files     | Gate #11 | Fields are declared, test payloads exist, and slice review is recorded (file-level audit trail) |

You can use both at the same time. If you use only Witness files and do not create the phase 4/5/6 files, Gate #11 skips silently — this is the recommended setup for new projects. If you have an existing project that already uses the phase 4/5/6 system, keep them; Gate #11 will continue to enforce complete coverage.
