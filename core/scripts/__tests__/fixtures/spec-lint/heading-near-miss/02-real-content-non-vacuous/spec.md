# Spec: fixture — heading-near-miss known-BOM

Fixture de teste para o check `heading-near-miss` (AC-01, spec 019). Corpus item 2 —
conhecido-BOM, não-vácuo.

### AC-01: forma canônica real

Given/When/Then de verdade — este heading tem exatos 3 `#`, um espaço, `AC-01` e
dois-pontos. É a forma que `soma-run.md:51` declara canônica e o check tem que
reconhecer como boa.

A forma antiga `### AC-01b: variante citada em prosa` foi citada aqui dentro de um code
span — a linha inteira começa com "A forma antiga", não com `#`, então o check não pode
acusá-la mesmo a linha contendo o texto near-miss no meio.
