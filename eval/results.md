# Recall evaluation

65 fragments, 46 cues, at most 10 results. Commit `7790f58`; Jev strictness `low`. Regenerate with `pnpm eval` (it bills Workers AI).

## Summary

Recall, nDCG, and MRR average over cues with hits; noise counts returned items that are neither hits nor marked ok.

| Setup | Recall@10 | nDCG@10 | MRR | Noise / cue | Returned / cue | Clean abstain | Failed recalls |
| --- | --- | --- | --- | --- | --- | --- | --- |
| jev low | 0.93 | 0.90 | 0.89 | 3.1 | 4.2 | 2/5 | 0 |

## By kind (recall / noise per cue)

| Kind (cues) | jev low |
| --- | --- |
| exact (5) | 1.00 / 1.2 |
| scattered (9) | 1.00 / 3.0 |
| morphology (7) | 1.00 / 3.7 |
| extra-word (6) | 1.00 / 1.3 |
| association (5) | 1.00 / 3.0 |
| multi-fragment (5) | 1.00 / 5.6 |
| semantic (4) | 0.25 / 2.3 |
| abstain (5) | — / 4.4 |

## Per case (hits found / hits, +noise)

| Case | Kind | Cue | jev low |
| --- | --- | --- | --- |
| c01 | exact | `allowedHosts` | 1/1 +0 |
| c02 | exact | `privacy manifest` | 1/1 +5 |
| c03 | exact | `integrity_check` | 1/1 +1 |
| c04 | exact | `Kafka consumer lag` | 1/1 +0 |
| c05 | exact | `presigned URLs` | 1/1 +0 |
| c06 | scattered | `D1 region` | 1/1 +3 |
| c07 | scattered | `vite 403` | 1/1 +1 |
| c08 | scattered | `test expects` | 1/1 +9 |
| c09 | scattered | `ledger SwiftUI` | 1/1 +6 |
| c10 | scattered | `restic retention` | 1/1 +0 |
| c11 | scattered | `staging database Sunday` | 1/1 +1 |
| c12 | scattered | `Java payments SDK` | 1/1 +2 |
| c13 | scattered | `Astro AVIF` | 1/1 +3 |
| c14 | scattered | `Japan passport` | 1/1 +2 |
| c15 | morphology | `evicted Durable Object` | 1/1 +9 |
| c16 | morphology | `eviction` | 1/1 +5 |
| c17 | morphology | `refresh staging` | 1/1 +0 |
| c18 | morphology | `migrate to SwiftData` | 1/1 +4 |
| c19 | morphology | `expiring TestFlight builds` | 1/1 +5 |
| c20 | morphology | `backup retention` | 1/1 +0 |
| c21 | morphology | `idempotent alarm handler` | 1/1 +3 |
| c22 | extra-word | `vite dev server 403 error` | 1/1 +2 |
| c23 | extra-word | `pandas leading zeros bug` | 1/1 +0 |
| c24 | extra-word | `colima docker desktop alternative` | 1/1 +0 |
| c25 | extra-word | `commit message style` | 1/1 +4 |
| c26 | extra-word | `VPN DNS issue` | 1/1 +1 |
| c27 | extra-word | `cat's pills` | 1/1 +1 |
| c28 | association | `Kyoto` | 2/2 +0 |
| c29 | association | `wrangler d1 migrations` | 1/1 +7 |
| c30 | association | `gateway envelope` | 1/1 +1 |
| c31 | association | `OrderTimeoutTest` | 1/1 +3 |
| c32 | association | `Durable Object alarms` | 1/1 +4 |
| c33 | multi-fragment | `pnpm` | 2/2 +8 |
| c34 | multi-fragment | `Japan` | 3/3 +1 |
| c35 | multi-fragment | `SwiftData` | 2/2 +4 |
| c36 | multi-fragment | `Workers AI` | 2/2 +8 |
| c37 | multi-fragment | `Durable Objects` | 3/3 +7 |
| c38 | semantic | `package manager` | 0/1 +0 |
| c39 | semantic | `antibiotics` | 0/1 +0 |
| c40 | semantic | `evening coffee` | 0/1 +0 |
| c41 | semantic | `code formatter` | 1/1 +9 |
| c42 | abstain | `memsys pricing` | 0/0 +10 |
| c43 | abstain | `kubernetes ingress` | 0/0 +0 |
| c44 | abstain | `ledger Android version` | 0/0 +7 |
| c45 | abstain | `birthday gift ideas` | 0/0 +0 |
| c46 | abstain | `Python type checker` | 0/0 +5 |
