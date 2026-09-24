# Plugins

Each plugin is one file in `plugins/`, registered in `plugins/index.ts`. Registry order is the order recall hooks run in. Settings are edited per instance on the Plugins page. How plugins fit the system is in [Architecture](../Architecture.md).

| Plugin | Kind | Default | Doc |
| --- | --- | --- | --- |
| Short memories (`size-limit`) | write check | on | [size-limit](size-limit.md) |
| Tag list (`list-tags`) | tool | on | [list-tags](list-tags.md) |
| Prioritize specific links (`idf`) | recall ranking | on | [idf](idf.md) |
| Relevance filter (`jev`) | recall filter | off | [jev](jev.md) |
