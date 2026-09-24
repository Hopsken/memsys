# Prioritize specific links (`idf`)

Ranks associated fragments by how specific their link is, so hub anchors like `#work` stop crowding out rare, meaningful ones. No settings.

- Each anchor weighs `ln((N+1)/(df+1))`, where `N` is the corpus size and `df` the number of fragments carrying it: high for rare anchors, near zero for hubs.
- An associated fragment scores the sum of the weights of its `via` anchors. Higher scores come first.
- Cue matches keep their place at the top. Ties keep recency order.
- `df` counts anchors literally, without the stemming association uses, and is recomputed on each recall.

On the test corpus, recalling "US West" lifts f7 (shares the rare `#d1`) above f4 and f6 (share only the `#memsys` hub).
