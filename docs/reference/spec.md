# Spec File Reference

The RiverGen spec file is a JSON file that describes one real-time domain. It is the single source of truth the generator reads to produce broadcast helpers, query-key factories, and hook scaffolding. The file is validated with Zod at run time; any violation halts generation with a structured parse error.

---

## Field Reference

| Field                  | Type        | Required | Validation                                                   | Notes                                                                                            |
| ---------------------- | ----------- | -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `version`              | literal `2` | yes      | Must be exactly `2`                                          | Any other value is rejected with a parse error. See [Version Requirement](#version-requirement). |
| `domain.key`           | string      | yes      | `^[a-z][a-z0-9-]*$` (kebab-case)                             | Used for file paths and directory names in generated output.                                     |
| `domain.displayName`   | string      | yes      | min length 1                                                 | Human-readable label used in generated comments and UI strings.                                  |
| `entity.key`           | string      | yes      | `^[a-z][a-zA-Z0-9]*$` (camelCase)                            | Used for TypeScript identifiers, class names, and type names.                                    |
| `entity.eventPrefix`   | string      | yes      | `^[a-z][a-z0-9-]*$` (kebab-case)                             | The prefix that every event name must start with.                                                |
| `events`               | string[]    | yes      | min 1 item; each item: `^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$` | Dot-notation only. Colon notation is explicitly rejected.                                        |
| `room.template`        | string      | yes      | min length 1                                                 | Room name template with `${varName}` placeholders.                                               |
| `room.visibilityField` | string      | no       | —                                                            | Field name on the entity payload used for PRIVATE room scoping.                                  |

Validation errors include the field path, for example:

```
[events.0] must match pattern ^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$
```

---

## Version Requirement

`version` must be the integer `2`. This field exists to distinguish the current format from the original v1 spec, which used colon-notation events (`entity:action`). Providing any value other than `2` — including the string `"2"`, the integer `1`, or omitting the field entirely — causes an immediate parse error.

```json
{ "version": 2 }   // accepted

{ "version": 1 }   // rejected
{ "version": "2" } // rejected
{}                  // rejected — version is required
```

---

## Key Fields and Naming Rules

### `domain.key` (kebab-case)

Identifies the domain in file paths. The generator uses this value to name output directories and files (for example, `task/` or `work-order/`).

Allowed pattern: `^[a-z][a-z0-9-]*$`

- Starts with a lowercase letter.
- May contain lowercase letters, digits, and hyphens.
- No uppercase, no underscores, no dots.

### `entity.key` (camelCase)

Used wherever the generator emits a TypeScript identifier: variable names, function names, type names, class names.

Allowed pattern: `^[a-z][a-zA-Z0-9]*$`

- Starts with a lowercase letter.
- May contain letters and digits; uppercase is allowed for camelCase humps.
- No hyphens, no underscores.

### `entity.eventPrefix` (kebab-case)

The generator enforces that every string in `events` starts with this prefix followed by a dot. The pattern is identical to `domain.key`.

Allowed pattern: `^[a-z][a-z0-9-]*$`

### When the three fields are the same string

For single-word entities the three fields can all carry the same value.

```json
"domain":  { "key": "task" },
"entity":  { "key": "task", "eventPrefix": "task" }
```

Here `domain.key`, `entity.key`, and `entity.eventPrefix` are all `"task"`. This is valid because `"task"` satisfies both the kebab-case regex and the camelCase regex.

### When the three fields differ

Multi-word entities require different casing in different contexts.

| Field                | Value          | Why                                                |
| -------------------- | -------------- | -------------------------------------------------- |
| `domain.key`         | `"work-order"` | File paths use kebab-case.                         |
| `entity.key`         | `"workOrder"`  | TypeScript identifiers use camelCase.              |
| `entity.eventPrefix` | `"work-order"` | Event prefixes are kebab-case like the domain key. |

The generator uses each field only in its designated context. You cannot collapse these into one value when the entity name is multi-word.

---

## Event Naming Rules

### Dot notation is required

Every event name must follow the pattern `prefix.action`, where `prefix` is a kebab-case segment and `action` may contain lowercase letters, digits, hyphens, and additional dots. Examples:

```
task.created
task.updated
work-order.created
work-order.status-changed
work-order.status.transitioned   ← additional dots in action are valid
```

Colon notation (`task:created`) was the v1 format. The validator rejects it with an explicit message:

```
Event names must use dot notation (e.g. "task.created"), not colon notation ("task:created")
```

### Prefix must match `entity.eventPrefix`

The segment before the first dot must equal `entity.eventPrefix` exactly. If `entity.eventPrefix` is `"work-order"` then every event must start with `"work-order."`.

```json
// entity.eventPrefix: "work-order"
"events": [
  "work-order.created",   // valid
  "workOrder.created",    // rejected — prefix is camelCase
  "task.created"          // rejected — prefix does not match eventPrefix
]
```

### At least one event is required

`events` must contain a minimum of one item. An empty array is rejected.

---

## Room Template Syntax

`room.template` is a string that defines the Socket.IO room name at runtime. It may contain literal text and any number of `${varName}` placeholders.

Placeholder syntax: `${varName}` where `varName` matches `\w+` (word characters only — letters, digits, underscore; no hyphens). The spec validator only checks that `room.template` is a non-empty string — placeholder syntax is enforced at `rivergen gen` time, not at `rivergen plan` or spec parse time.

```
"project:${projectId}"
"workspace:${workspaceId}"
"tenant:${tenantId}:user:${userId}"
```

### What placeholder variables become in generated code

Each unique placeholder variable is extracted and used in three places:

**Broadcast helper parameter**

```typescript
const projectId = payload.projectId as string;
```

The variable name is read from the payload under the same key.

**Query-key factory context type**

```typescript
list: (ctx: { projectId: string }) => [...]
```

The variable becomes a required field on the context object passed to query key factories.

**Room join hook comment**

```typescript
// socket.emit("join:task", projectId)
```

The variable appears as the argument in the illustrative emit call inside the generated hook scaffold.

---

## `room.visibilityField`

### Purpose

Some entities can be either public or private. When `visibilityField` is set, the generator knows which field on the entity payload carries the visibility value, and it emits an `isPrivate` guard inside the broadcast helper.

### What the generator produces

With `"visibilityField": "visibility"` the broadcast helper contains:

```typescript
const isPrivate = payload.visibility === "PRIVATE";
if (isPrivate) {
  // emit to narrow private room
} else {
  // emit to workspace room
}
```

Without `visibilityField`, no guard is generated and every broadcast goes to the workspace room unconditionally.

### Gate 5 — Broadcast Room Scoping

Gate 5 inspects broadcast functions at audit time. It fires a warning when:

- A broadcast function accepts a `visibility` or `isPrivate` parameter (or the payload type includes such a field), **and**
- The function emits to a `workspace:` room without a guard that checks the visibility value.

The intent is to prevent private entity data from being broadcast into a public workspace room. Setting `visibilityField` in the spec ensures the generator produces the guard. Omitting it for an entity that can be PRIVATE causes Gate 5 to warn on every audit run until the guard is added manually or `visibilityField` is set and the file is regenerated.

---

## Complete Examples

### Single-word domain (task)

```json
{
  "version": 2,
  "domain": {
    "key": "task",
    "displayName": "Task"
  },
  "entity": {
    "key": "task",
    "eventPrefix": "task"
  },
  "events": ["task.created", "task.updated", "task.deleted"],
  "room": {
    "template": "project:${projectId}"
  }
}
```

`domain.key`, `entity.key`, and `entity.eventPrefix` are all `"task"`. No `visibilityField` — all tasks are broadcast to the project room unconditionally.

### Multi-word domain with visibility scoping (work order)

```json
{
  "version": 2,
  "domain": {
    "key": "work-order",
    "displayName": "Work Order"
  },
  "entity": {
    "key": "workOrder",
    "eventPrefix": "work-order"
  },
  "events": ["work-order.created", "work-order.updated", "work-order.deleted"],
  "room": {
    "template": "workspace:${workspaceId}",
    "visibilityField": "visibility"
  }
}
```

`domain.key` and `entity.eventPrefix` are both `"work-order"` (kebab-case). `entity.key` is `"workOrder"` (camelCase). `visibilityField` is set so the generator emits an `isPrivate` guard in the broadcast helper.

---

## Common Mistakes

### Using colon notation for events

```json
// wrong
"events": ["task:created", "task:updated"]

// correct
"events": ["task.created", "task.updated"]
```

Colon notation is the v1 format. The validator rejects it immediately with a message naming the offending event.

### Event prefix does not match `entity.eventPrefix`

```json
// entity.eventPrefix is "work-order"
// wrong — prefix is camelCase
"events": ["workOrder.created"]

// wrong — prefix is a different word
"events": ["order.created"]

// correct
"events": ["work-order.created"]
```

The prefix of every event (the segment before the first dot) must exactly equal `entity.eventPrefix`.

### Using camelCase for `entity.eventPrefix`

```json
// wrong
"entity": { "key": "workOrder", "eventPrefix": "workOrder" }

// correct
"entity": { "key": "workOrder", "eventPrefix": "work-order" }
```

`entity.eventPrefix` follows the same kebab-case pattern as `domain.key`, not the camelCase pattern of `entity.key`.

### Omitting `visibilityField` for a PRIVATE-capable entity

If your entity has a `visibility` field that can be `"PRIVATE"`, omitting `visibilityField` means the generator produces no guard. The broadcast helper will emit private data to a public workspace room, and Gate 5 will flag every audit until the guard is present.

```json
// if the entity payload can carry visibility: "PRIVATE", set this
"room": {
  "template": "workspace:${workspaceId}",
  "visibilityField": "visibility"
}
```

### Wrong `version` value

```json
// wrong — string instead of integer
{ "version": "2" }

// wrong — v1 value
{ "version": 1 }

// correct
{ "version": 2 }
```
