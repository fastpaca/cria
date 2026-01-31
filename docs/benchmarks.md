# Benchmarks

Benchmarks run via `npm run bench` (Vitest bench). To compare against a local
baseline, run `npm run bench:baseline` once and then `npm run bench:compare`.
Baseline JSON files are gitignored. Numbers below are from a single run on a
dev machine on 2026-01-31 and are hardware-dependent.

## Golden render loop (standard summary-first)

| Scenario | hz | mean (ms) |
| --- | --- | --- |
| build + render baseline (no fit loop) | 474.28 | 2.1085 |
| render prebuilt baseline (no fit loop) | 477.91 | 2.0924 |
| render prebuilt fit budget (cold summary store) | 277.79 | 3.5998 |
| render prebuilt tight budget (warm summary store) | 277.87 | 3.5988 |

## Golden render loop (multi-strategy stress)

| Scenario | hz | mean (ms) |
| --- | --- | --- |
| render prebuilt fit budget (cold summary store) | 99.2507 | 10.0755 |

## Golden render loop (huge trees)

| Scenario | hz | mean (ms) |
| --- | --- | --- |
| build + render baseline (huge, no fit loop) | 82.8719 | 12.0668 |
| render prebuilt baseline (huge, no fit loop) | 83.5962 | 11.9623 |
| render prebuilt fit budget (huge, cold summary store) | 51.3496 | 19.4743 |
| render prebuilt tight budget (huge, warm summary store) | 53.4079 | 18.7238 |

## Golden render loop (20k messages)

| Scenario | hz | mean (ms) |
| --- | --- | --- |
| render prebuilt baseline (20k, no fit loop) | 15.8345 | 63.1533 |
| render prebuilt fit budget (20k, cold summary store) | 15.0595 | 66.4032 |
| render prebuilt tight budget (20k, warm summary store) | 15.0367 | 66.5041 |

## Provider codec render loop (OpenAI chat)

| Scenario | hz | mean (ms) |
| --- | --- | --- |
| render baseline (chat codec) | 182.14 | 5.4902 |
| render fit budget (chat codec) | 135.45 | 7.3828 |
| render tight budget (chat codec) | 136.30 | 7.3365 |
| render multi-strategy stress (chat codec) | 48.6139 | 20.5702 |

## Provider codec render loop (OpenAI responses)

| Scenario | hz | mean (ms) |
| --- | --- | --- |
| render baseline (responses codec) | 182.98 | 5.4651 |
| render fit budget (responses codec) | 136.33 | 7.3351 |
| render tight budget (responses codec) | 136.74 | 7.3133 |
| render multi-strategy stress (responses codec) | 49.6419 | 20.1443 |

## Provider codec render loop (AI SDK)

| Scenario | hz | mean (ms) |
| --- | --- | --- |
| render baseline (ai-sdk codec) | 165.21 | 6.0527 |
| render fit budget (ai-sdk codec) | 123.95 | 8.0678 |
| render tight budget (ai-sdk codec) | 125.98 | 7.9377 |
| render multi-strategy stress (ai-sdk codec) | 44.6337 | 22.4046 |
