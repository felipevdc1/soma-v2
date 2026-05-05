# Contract: Tool Call — {TOOL_NAME}

<!-- guidance: One file per MCP tool or slash command. Includes args schema, output schema, side effects. -->

**Contract ID:** {CONTRACT-ID}
**spec_ref:** [SPEC:{AC-XX}]
**Created:** {YYYY-MM-DD}
**Type:** MCP tool | slash command | internal tool

---

## Tool Name

```
{tool_name}   <!-- snake_case for MCP tools; /kebab-case for slash commands -->
```

---

## Description

<!-- guidance: One sentence. What does this tool do for its caller? -->

{One-sentence description visible to the LLM when it decides to call this tool.}

---

## Arguments

```json
{
  "{arg_name}": {
    "type": "{string|number|boolean|object|array}",
    "required": true,
    "description": "{what this arg controls}",
    "example": "{concrete example value}"
  }
}
```

**Argument constraints:**
| Arg | Type | Required | Constraints |
|---|---|---|---|
| `{arg_name}` | `{type}` | {yes\|no} | {e.g., non-empty, valid path, max 1000 chars} |

---

## Output

**Success:**
```json
{
  "{field}": "{type — description}"
}
```

**Error:**
```json
{
  "error": "{ERROR_CODE}",
  "message": "{human-readable description}"
}
```

**Error codes:**
| Code | When |
|---|---|
| `{ERROR_CODE}` | {condition} |
| `TOOL_NOT_FOUND` | Tool name does not exist in registry |
| `INVALID_ARGS` | Required arg missing or wrong type |

---

## Side Effects

<!-- guidance: List every observable state change. "None" = read-only tool (can run unlimited under Article V). -->

- {e.g., Writes file at {path}}
- {e.g., Inserts row in `{table}`}
- <!-- None — read-only (thermal-guard: does NOT count toward compile/test limit) -->

---

## Idempotency

<!-- guidance: Is calling this tool twice with same args safe? What happens? -->

- **Idempotent:** {yes | no | conditional}
- **If called twice:** {e.g., second call is a no-op | returns same result | creates duplicate}

---

## Contract Test Stub

```typescript
// @spec {AC-XX}
// @contract {CONTRACT-ID}
describe("tool {tool_name}", () => {
  it("returns expected output for valid args", async () => {
    const result = await callTool("{tool_name}", {/* valid args */});
    // assert output shape + specific fields
  });
  it("returns INVALID_ARGS when required arg missing", async () => {
    const result = await callTool("{tool_name}", {/* missing required arg */});
    // assert error code
  });
  it("is idempotent (if applicable)", async () => {
    // call twice with same args
    // assert state changed only once
  });
});
```
