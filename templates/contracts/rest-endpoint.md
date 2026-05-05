# Contract: {ENDPOINT_NAME}

<!-- guidance: One file per endpoint. Contract tests must be written before implementation (Article III). -->

**Contract ID:** {CONTRACT-ID}
**spec_ref:** [SPEC:{AC-XX}]
**Created:** {YYYY-MM-DD}

---

## Method & Path

```
{METHOD} {/path/to/endpoint}
```

---

## Request

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {token}   <!-- remove if not auth-required -->
```

**Path params:**
| Param | Type | Required | Description |
|---|---|---|---|
| `{param}` | `{string\|number}` | {yes\|no} | {description} |

**Query params:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `{param}` | `{type}` | {yes\|no} | `{default}` | {description} |

**Body:**
```json
{
  "{field}": "{type — description}"
}
```

---

## Response

**Success — {2XX}:**
```json
{
  "{field}": "{type — description}"
}
```

**Error responses:**
| Status | Code | When |
|---|---|---|
| 400 | `{ERROR_CODE}` | {condition} |
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 404 | `NOT_FOUND` | {condition} |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## Side Effects

<!-- guidance: What changes in system state after this call. "None" is a valid answer for GET. -->

- {e.g., Creates row in `orders` table with status=PENDING}

---

## Contract Test Stub

<!-- guidance: Copy into tests/contract/{endpoint}.test.ts. Fill in assertions. -->

```typescript
// @spec {AC-XX}
// @contract {CONTRACT-ID}
describe("{METHOD} {/path}", () => {
  it("returns {2XX} when {happy path}", async () => {
    // arrange
    // act
    // assert shape + status
  });
  it("returns 4XX when {error case}", async () => {
    // arrange
    // act
    // assert error code
  });
});
```
