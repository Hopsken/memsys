# Jev as judge, run `baseline-1021`

120 answers already graded by DeepSeek (`deepseek-flash` with LongMemEval's prompts), graded again by Jev (`jev-1.13.0`), correct when its score is at least 0.5. Regenerate with `node eval/longmemeval/jev-judge.ts --run baseline-1021`.

Agreement: **115/120**.

| Setup | DeepSeek correct | Jev correct |
| --- | --- | --- |
| memsys | 53 | 52 |
| full context | 54 | 54 |

| Type | Agreement |
| --- | --- |
| multi-session | 18/18 |
| abstention | 5/6 |
| single-session-preference | 18/20 |
| knowledge-update | 17/18 |
| single-session-assistant | 19/20 |
| single-session-user | 18/18 |
| temporal-reasoning | 20/20 |

## Disagreements

| Question | Type | Setup | DeepSeek | Jev score | Expected | Response (end) |
| --- | --- | --- | --- | --- | --- | --- |
| 1c0ddc50 | single-session-preference | full context | right | 0.24 | The user would prefer suggestions related to listening to new podcasts or audiob | 30–60 minute podcast episodes and alternate shows to keep things fresh. **Safety note:** If you’re biking, keep the volume low, avoid noise-blocking earbuds, secure your phone properly, and prioritize awareness of traffic and surroundings. |
| 1c0ddc50 | single-session-preference | memsys | right | 0.44 | The user would prefer suggestions related to listening to new podcasts or audiob | journal entry (safest on the bus). - A quick stretch/breathing routine — box breathing on the ride home helps decompress. Want me to suggest a couple of specific podcasts or audiobooks, or build a weekly commute plan around the bike route? |
| 1d4da289 | single-session-assistant | memsys | right | 0.46 | I mentioned biometric authentication or one-time passwords (OTP) as examples of  | fingerprint or face as a factor, usually paired with a password - **Email codes and printed backup codes** — fallback/recovery methods If you tell me which one sounds familiar, I can go deeper — or we can just treat this as a fresh answer. |
| 80ec1f4f_abs | multi-session | full context | wrong | 0.58 | 0. You did not mention visitng any museum in December | museum/gallery visits are in January and February. There is no evidence in the chat history of any museum or gallery visit in December. **Answer:** Based on the chat history, **0** museums or galleries are recorded as visited in December. |
| a2f3aa27 | knowledge-update | memsys | wrong | 0.83 | 1300 | ng I have is from **May 25, 2023**: your Instagram follower count was **close to 1,300 and growing** (an earlier note from that same day said 1,250). I don't have any newer figure — if you've checked since then, tell me and I'll update it. |
