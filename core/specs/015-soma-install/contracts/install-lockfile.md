# Contract: File Format — install.lock

**Contract ID:** CONTRACT-05
**spec_ref:** [SPEC NFR Concurrency, NCL-4 resolution]
**Created:** 2026-05-09
**Type:** internal file format (concurrency lock)

---

## File Path

```
<project-path>/.soma/install.lock
```

Per-project scope (each project has independent lock). Created at install start, removed in finally block (success OR failure).

---

## Schema

```json
{
  "$schema": "soma-install-lock/v1",
  "type": "object",
  "required": ["pid", "timestamp", "hostname"],
  "properties": {
    "pid": {
      "type": "integer",
      "description": "Process ID of install.cjs invocation"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "ISO-8601 of lock acquisition (used for stale detection)"
    },
    "hostname": {
      "type": "string",
      "description": "Machine hostname — useful in shared filesystem scenarios (NFS, etc.)"
    }
  }
}
```

---

## Example

```json
{
  "$schema": "soma-install-lock/v1",
  "pid": 12345,
  "timestamp": "2026-05-09T14:50:00Z",
  "hostname": "felipe-mac.local"
}
```

---

## Lock Lifecycle

```
install start:
  if exists .soma/install.lock:
    read lock JSON
    age = now - lock.timestamp
    if age < 60min:
      ABORT exit 2 with msg "Install in progress (PID {pid}, started {timestamp})"
    else:
      WARNING "Stale lock detected (PID {pid}, age {N}min). Auto-cleaning."
      remove .soma/install.lock
  write .soma/install.lock with current pid+timestamp+hostname

[run install pipeline]

install end (success or failure):
  finally block:
    remove .soma/install.lock (idempotent — ignore ENOENT)
```

---

## Stale Detection (60min threshold)

Rationale: install completes in < 8s p95. A 60min stale threshold is generous (>>p99); covers crashed processes that didn't reach finally block. Prevents indefinite blocking.

**NOT 5min**: too aggressive, might falsely treat an active install as stale.
**NOT 24h**: too lenient, blocks user from retrying after crash for entire day.

---

## Edge Cases

- **Concurrent invocations same project**: second install reads lock, sees age < 60min, aborts with PID hint. User can manually `rm .soma/install.lock` if they're sure first invocation died.
- **Process crashed before finally**: lock persists. After 60min, next install auto-cleans with WARNING.
- **Filesystem doesn't support atomic rename** (rare): write lock via fs.writeFileSync — accept tiny race window (<1ms). Lockfile is advisory, not RFC-strict.
- **NFS shared filesystem**: hostname field allows distinguishing "my crashed install" vs "another machine's active install". User decides manually.

---

## Invariants

- Lock file MUST be valid JSON
- Lock acquired BEFORE first mutation (init step)
- Lock removed in finally{} regardless of exit path
- Stale lock auto-clean MUST log to stderr (silent cleanup is anti-pattern)
- Lock file mode 0644 (user RW, others R)
- File NOT committed to git (add `.soma/install.lock` to `.gitignore` template if not already)
