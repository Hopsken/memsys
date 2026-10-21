# Full context against memsys, run `baseline-1021`

The same 60 questions, answered by `deepseek-flash` with thinking on and every session in the prompt (LongMemEval's own full-context prompt), graded by the same judge. Average prompt 105,479 tokens; cost $1.96 at list prices. Regenerate with `node eval/longmemeval/full-context.ts --run baseline-1021`.

| Type | memsys + Pi | Full context |
| --- | --- | --- |
| multi-session | 10/10 | 7/10 |
| knowledge-update | 8/10 | 7/10 |
| single-session-preference | 8/10 | 10/10 |
| single-session-assistant | 8/10 | 10/10 |
| single-session-user | 9/10 | 10/10 |
| temporal-reasoning | 10/10 | 10/10 |
| **all** | 53/60 | 54/60 |

## Questions where they disagree

| Question | Type | memsys | Full context | Full-context answer |
| --- | --- | --- | --- | --- |
| 07741c45 | knowledge-update | right | wrong |  storage, and they’re starting to smell.” Later you mentioned planning to organize your closet and store old sneakers in a shoe rack, but the history does not confirm that you actually moved them yet. |
| 09ba9854 | multi-session | right | wrong |  taxi fare is around $60. If you use a cheaper commuter train and then a short taxi/walk to the hotel, the savings could be larger, but the exact amount depends on your hotel location and train route. |
| 1a1907b4 | single-session-preference | wrong | right | cumber, grapefruit, mint, or edible flowers. If you want a backup option, the **Cucumber Gimlet** or **Gin-Gin Mule** from the earlier list would also be simple, refreshing choices for a get-together. |
| 488d3006 | single-session-assistant | wrong | right | ular hiking trail of approximately 36 km that passes through the park’s most stunning landscapes and offers panoramic views of the surrounding mountainside. Answer: The hiking trail was the **GR-90**. |
| 51a45a95 | single-session-user | wrong | right |  email inbox**. The chat does **not explicitly name the store**, but the surrounding context is about using Target’s **Cartwheel app**, so it was likely a **Target** coupon/redemption found via email. |
| 75832dbd | single-session-preference | wrong | right | , NeurIPS, CVPR, and ICLR using keywords like “explainable AI medical imaging,” “vision transformer medical segmentation,” “multimodal fusion medical imaging,” and “domain adaptation medical imaging.” |
| 80ec1f4f_abs | multi-session | right | wrong | nd February. There is no evidence in the chat history of any museum or gallery visit in December. **Answer:** Based on the chat history, **0** museums or galleries are recorded as visited in December. |
| a11281a2 | multi-session | right | wrong | s, though another session mentions starting the year with 250 followers, which would make the total rise to ~350 about 100 followers since the start of the year, not necessarily just within two weeks. |
| eaca4986 | single-session-assistant | wrong | right |  A – G – F – E – D – C** However, the chat history gives **notes/melody**, not actual chord symbols. So there is no specified chord progression for that chorus beyond the repeated note sequence above. |
