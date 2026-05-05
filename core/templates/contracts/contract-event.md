# Contract: Event — {EVENT_NAME}

<!-- guidance: One file per event type. Consumers must not depend on fields not listed here. -->

**Contract ID:** {CONTRACT-ID}
**spec_ref:** [SPEC:{AC-XX}]
**Created:** {YYYY-MM-DD}

---

## Event Name

```
{namespace.entity.verb}   <!-- e.g., orders.payment.completed -->
```

---

## Payload

```json
{
  "event": "{namespace.entity.verb}",
  "id": "{uuid — unique event ID}",
  "timestamp": "{ISO 8601}",
  "version": "{semver — e.g., 1.0.0}",
  "data": {
    "{field}": "{type — description}"
  }
}
```

**Field constraints:**
| Field | Type | Required | Constraints |
|---|---|---|---|
| `data.{field}` | `{type}` | {yes\|no} | {e.g., non-empty string, max 255 chars} |

---

## Emitter

<!-- guidance: Which service/module publishes this event. -->

- **Service:** `{service-name}`
- **When emitted:** {condition — e.g., "after payment confirmed by payment provider"}

---

## Consumers

<!-- guidance: List ALL known consumers. Adding a consumer = update this file. -->

| Consumer | What it does with this event |
|---|---|
| `{service-name}` | {e.g., updates order status to PAID} |

---

## Ordering & Delivery Guarantees

<!-- guidance: at-least-once? exactly-once? ordered per entity? -->

- **Delivery:** {at-least-once | exactly-once}
- **Ordering:** {unordered | ordered per `data.{entity_id}`}
- **Idempotency key:** `{field used to deduplicate — e.g., data.order_id + event.id}`

---

## Side Effects

- {What changes in system state when this event is processed by each consumer}

---

## Contract Test Stub

```typescript
// @spec {AC-XX}
// @contract {CONTRACT-ID}
describe("event {namespace.entity.verb}", () => {
  it("payload matches schema", () => {
    const event = buildEvent({/* minimal valid payload */});
    // assert required fields present, types correct
  });
  it("consumer {service} handles event idempotently", async () => {
    // emit twice with same idempotency key
    // assert side effect applied exactly once
  });
});
```
