# Recall evaluation

65 fragments, 46 cues, limit 10. Commit `e3f6612`; Jev strictness `medium`. Regenerate with `pnpm eval` (`JEV=1 pnpm eval` for Jev; it bills Workers AI).

## Summary

Recall, nDCG, and MRR average over cues with hits; noise counts returned items that are neither hits nor marked ok.

| Setup | Recall@10 | nDCG@10 | MRR | Noise / cue | Returned / cue | Clean abstain | Hook failures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| core | 0.88 | 0.87 | 0.87 | 6.2 | 7.3 | 5/5 | 0 |
| idf | 0.88 | 0.87 | 0.87 | 6.2 | 7.3 | 5/5 | 0 |
| idf+jev | 0.88 | 0.87 | 0.87 | 0.8 | 1.9 | 5/5 | 0 |
| idf+jev(matches) | 0.88 | 0.87 | 0.87 | 0.6 | 1.6 | 5/5 | 0 |

## By kind (recall / noise per cue)

| Kind (cues) | core | idf | idf+jev | idf+jev(matches) |
| --- | --- | --- | --- | --- |
| exact (5) | 1.00 / 8.2 | 1.00 / 8.2 | 1.00 / 0.2 | 1.00 / 0.0 |
| scattered (9) | 1.00 / 7.9 | 1.00 / 7.9 | 1.00 / 1.7 | 1.00 / 0.9 |
| morphology (7) | 1.00 / 7.9 | 1.00 / 7.9 | 1.00 / 1.1 | 1.00 / 1.0 |
| partial (6) | 0.83 / 7.5 | 0.83 / 7.5 | 0.83 / 0.5 | 0.83 / 0.2 |
| association (5) | 1.00 / 7.2 | 1.00 / 7.0 | 1.00 / 0.6 | 1.00 / 0.4 |
| multi (5) | 1.00 / 7.2 | 1.00 / 7.2 | 1.00 / 1.8 | 1.00 / 1.8 |
| semantic (4) | 0.00 / 0.0 | 0.00 / 0.0 | 0.00 / 0.0 | 0.00 / 0.0 |
| abstain (5) | — / 0.0 | — / 0.0 | — / 0.0 | — / 0.0 |

## Per case (hits found / hits, +noise)

| Case | Kind | Cue | core | idf | idf+jev | idf+jev(matches) |
| --- | --- | --- | --- | --- | --- | --- |
| c01 | exact | `allowedHosts` | 1/1 +9 | 1/1 +9 | 1/1 +0 | 1/1 +0 |
| c02 | exact | `privacy manifest` | 1/1 +9 | 1/1 +9 | 1/1 +1 | 1/1 +0 |
| c03 | exact | `integrity_check` | 1/1 +9 | 1/1 +9 | 1/1 +0 | 1/1 +0 |
| c04 | exact | `Kafka consumer lag` | 1/1 +9 | 1/1 +9 | 1/1 +0 | 1/1 +0 |
| c05 | exact | `presigned URLs` | 1/1 +5 | 1/1 +5 | 1/1 +0 | 1/1 +0 |
| c06 | scattered | `D1 region` | 1/1 +9 | 1/1 +9 | 1/1 +0 | 1/1 +0 |
| c07 | scattered | `vite 403` | 1/1 +9 | 1/1 +9 | 1/1 +2 | 1/1 +0 |
| c08 | scattered | `test expects` | 1/1 +9 | 1/1 +9 | 1/1 +7 | 1/1 +5 |
| c09 | scattered | `ledger SwiftUI` | 1/1 +6 | 1/1 +6 | 1/1 +3 | 1/1 +2 |
| c10 | scattered | `restic retention` | 1/1 +4 | 1/1 +4 | 1/1 +0 | 1/1 +0 |
| c11 | scattered | `staging database Sunday` | 1/1 +9 | 1/1 +9 | 1/1 +0 | 1/1 +0 |
| c12 | scattered | `Java payments SDK` | 1/1 +9 | 1/1 +9 | 1/1 +0 | 1/1 +0 |
| c13 | scattered | `Astro AVIF` | 1/1 +9 | 1/1 +9 | 1/1 +0 | 1/1 +0 |
| c14 | scattered | `Japan passport` | 1/1 +7 | 1/1 +7 | 1/1 +3 | 1/1 +1 |
| c15 | morphology | `evicted Durable Object` | 1/1 +9 | 1/1 +9 | 1/1 +2 | 1/1 +2 |
| c16 | morphology | `eviction` | 1/1 +9 | 1/1 +9 | 1/1 +1 | 1/1 +2 |
| c17 | morphology | `refresh staging` | 1/1 +9 | 1/1 +9 | 1/1 +0 | 1/1 +0 |
| c18 | morphology | `migrate to SwiftData` | 1/1 +9 | 1/1 +9 | 1/1 +3 | 1/1 +2 |
| c19 | morphology | `expiring TestFlight builds` | 1/1 +6 | 1/1 +6 | 1/1 +0 | 1/1 +0 |
| c20 | morphology | `backup retention` | 1/1 +4 | 1/1 +4 | 1/1 +0 | 1/1 +0 |
| c21 | morphology | `idempotent alarm handler` | 1/1 +9 | 1/1 +9 | 1/1 +2 | 1/1 +1 |
| c22 | partial | `vite dev server 403 error` | 1/1 +9 | 1/1 +9 | 1/1 +1 | 1/1 +0 |
| c23 | partial | `pandas leading zeros bug` | 1/1 +9 | 1/1 +9 | 1/1 +0 | 1/1 +0 |
| c24 | partial | `colima docker desktop alternative` | 1/1 +9 | 1/1 +9 | 1/1 +0 | 1/1 +0 |
| c25 | partial | `commit message style` | 1/1 +9 | 1/1 +9 | 1/1 +1 | 1/1 +1 |
| c26 | partial | `VPN DNS issue` | 1/1 +9 | 1/1 +9 | 1/1 +1 | 1/1 +0 |
| c27 | partial | `cat's pills` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c28 | association | `Kyoto` | 2/2 +5 | 2/2 +5 | 2/2 +0 | 2/2 +0 |
| c29 | association | `wrangler d1 migrations` | 1/1 +9 | 1/1 +8 | 1/1 +2 | 1/1 +2 |
| c30 | association | `gateway envelope` | 1/1 +7 | 1/1 +7 | 1/1 +1 | 1/1 +0 |
| c31 | association | `OrderTimeoutTest` | 1/1 +8 | 1/1 +8 | 1/1 +0 | 1/1 +0 |
| c32 | association | `Durable Object alarms` | 1/1 +7 | 1/1 +7 | 1/1 +0 | 1/1 +0 |
| c33 | multi | `pnpm` | 2/2 +8 | 2/2 +8 | 2/2 +7 | 2/2 +4 |
| c34 | multi | `Japan` | 3/3 +5 | 3/3 +5 | 3/3 +0 | 3/3 +0 |
| c35 | multi | `SwiftData` | 2/2 +8 | 2/2 +8 | 2/2 +2 | 2/2 +2 |
| c36 | multi | `Workers AI` | 2/2 +8 | 2/2 +8 | 2/2 +0 | 2/2 +0 |
| c37 | multi | `Durable Objects` | 3/3 +7 | 3/3 +7 | 3/3 +0 | 3/3 +3 |
| c38 | semantic | `package manager` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c39 | semantic | `antibiotics` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c40 | semantic | `evening coffee` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c41 | semantic | `code formatter` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c42 | abstain | `memsys pricing` | 0/0 +0 | 0/0 +0 | 0/0 +0 | 0/0 +0 |
| c43 | abstain | `kubernetes ingress` | 0/0 +0 | 0/0 +0 | 0/0 +0 | 0/0 +0 |
| c44 | abstain | `ledger Android version` | 0/0 +0 | 0/0 +0 | 0/0 +0 | 0/0 +0 |
| c45 | abstain | `birthday gift ideas` | 0/0 +0 | 0/0 +0 | 0/0 +0 | 0/0 +0 |
| c46 | abstain | `Python type checker` | 0/0 +0 | 0/0 +0 | 0/0 +0 | 0/0 +0 |
