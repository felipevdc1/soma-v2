You are auditing a SOMA module to support a future /specify invocation.

## Module facts
Path: {{module.path}}
LOC: {{module.loc}}
Test count: {{module.test_count}}

## Header comment
{{module.header_comment}}

## Exports
{{#module.exports}}- {{.}}
{{/module.exports}}

## Export signatures
{{#module.export_signatures}}- {{.}}
{{/module.export_signatures}}

## Recent commits (last 10)
{{#module.recent_commits}}- {{sha}} {{date}} — {{subject}}
{{/module.recent_commits}}

## Help text
{{module.help_text}}

## Task
Return JSON with:
- capabilities[]: what this module CAN do today (one phrase per item)
- bugs[]: empirical bugs/gaps you can infer (severity: low|medium|high; source: which fact above led you)
- recent_changes[]: human-readable summary of last 10 commits
- recommended_spec_scope: one-paragraph guidance for a /specify invocation that extends this module — what to avoid (already done) and what to include (gaps).

## Output format (CRITICAL)

Output a single raw JSON object. Do NOT wrap in markdown code fences. Do NOT use ```json or ``` anywhere. Do NOT add any prose before or after the JSON. The first character of your response MUST be `{` and the last character MUST be `}`.
