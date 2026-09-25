# Recall evaluation

65 fragments, 46 cues, limit 10. Commit `d8633d4`; Jev strictness `medium`. Regenerate with `pnpm eval` (`JEV=1 pnpm eval` for Jev; it bills Workers AI).

## Summary

Recall, nDCG, and MRR average over cues with hits; noise counts returned items that are neither hits nor marked ok.

| Setup | Recall@10 | nDCG@10 | MRR | Noise / cue | Returned / cue | Clean abstain | Hook failures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| core | 0.37 | 0.35 | 0.35 | 2.5 | 3.1 | 5/5 | 0 |
| idf | 0.37 | 0.36 | 0.35 | 2.5 | 3.1 | 5/5 | 0 |
| idf+jev | 0.37 | 0.36 | 0.35 | 0.3 | 0.8 | 5/5 | 0 |
| idf+jev(matches) | 0.37 | 0.36 | 0.35 | 0.2 | 0.7 | 5/5 | 0 |

## By kind (recall / noise per cue)

| Kind (cues) | core | idf | idf+jev | idf+jev(matches) |
| --- | --- | --- | --- | --- |
| exact (5) | 1.00 / 8.2 | 1.00 / 8.2 | 1.00 / 0.2 | 1.00 / 0.0 |
| scattered (9) | 0.00 / 0.0 | 0.00 / 0.0 | 0.00 / 0.0 | 0.00 / 0.0 |
| morphology (7) | 0.14 / 1.3 | 0.14 / 1.3 | 0.14 / 0.1 | 0.14 / 0.3 |
| partial (6) | 0.00 / 0.0 | 0.00 / 0.0 | 0.00 / 0.0 | 0.00 / 0.0 |
| association (5) | 1.00 / 7.2 | 1.00 / 7.0 | 1.00 / 0.8 | 1.00 / 0.4 |
| multi (5) | 0.80 / 5.8 | 0.80 / 5.8 | 0.80 / 2.0 | 0.80 / 1.2 |
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
| c06 | scattered | `D1 region` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c07 | scattered | `vite 403` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c08 | scattered | `test expects` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c09 | scattered | `ledger SwiftUI` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c10 | scattered | `restic retention` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c11 | scattered | `staging database Sunday` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c12 | scattered | `Java payments SDK` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c13 | scattered | `Astro AVIF` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c14 | scattered | `Japan passport` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c15 | morphology | `evicted Durable Object` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c16 | morphology | `eviction` | 1/1 +9 | 1/1 +9 | 1/1 +1 | 1/1 +2 |
| c17 | morphology | `refresh staging` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c18 | morphology | `migrate to SwiftData` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c19 | morphology | `expiring TestFlight builds` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c20 | morphology | `backup retention` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c21 | morphology | `idempotent alarm handler` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c22 | partial | `vite dev server 403 error` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c23 | partial | `pandas leading zeros bug` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c24 | partial | `colima docker desktop alternative` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c25 | partial | `commit message style` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c26 | partial | `VPN DNS issue` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c27 | partial | `cat's pills` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c28 | association | `Kyoto` | 2/2 +5 | 2/2 +5 | 2/2 +0 | 2/2 +0 |
| c29 | association | `wrangler d1 migrations` | 1/1 +9 | 1/1 +8 | 1/1 +2 | 1/1 +2 |
| c30 | association | `gateway envelope` | 1/1 +7 | 1/1 +7 | 1/1 +1 | 1/1 +0 |
| c31 | association | `OrderTimeoutTest` | 1/1 +8 | 1/1 +8 | 1/1 +1 | 1/1 +0 |
| c32 | association | `Durable Object alarms` | 1/1 +7 | 1/1 +7 | 1/1 +0 | 1/1 +0 |
| c33 | multi | `pnpm` | 2/2 +8 | 2/2 +8 | 2/2 +8 | 2/2 +4 |
| c34 | multi | `Japan` | 3/3 +5 | 3/3 +5 | 3/3 +0 | 3/3 +0 |
| c35 | multi | `SwiftData` | 2/2 +8 | 2/2 +8 | 2/2 +2 | 2/2 +2 |
| c36 | multi | `Workers AI` | 2/2 +8 | 2/2 +8 | 2/2 +0 | 2/2 +0 |
| c37 | multi | `Durable Objects` | 0/3 +0 | 0/3 +0 | 0/3 +0 | 0/3 +0 |
| c38 | semantic | `package manager` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c39 | semantic | `antibiotics` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c40 | semantic | `evening coffee` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c41 | semantic | `code formatter` | 0/1 +0 | 0/1 +0 | 0/1 +0 | 0/1 +0 |
| c42 | abstain | `memsys pricing` | 0/0 +0 | 0/0 +0 | 0/0 +0 | 0/0 +0 |
| c43 | abstain | `kubernetes ingress` | 0/0 +0 | 0/0 +0 | 0/0 +0 | 0/0 +0 |
| c44 | abstain | `ledger Android version` | 0/0 +0 | 0/0 +0 | 0/0 +0 | 0/0 +0 |
| c45 | abstain | `birthday gift ideas` | 0/0 +0 | 0/0 +0 | 0/0 +0 | 0/0 +0 |
| c46 | abstain | `Python type checker` | 0/0 +0 | 0/0 +0 | 0/0 +0 | 0/0 +0 |
