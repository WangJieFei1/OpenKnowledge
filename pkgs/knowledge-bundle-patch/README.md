# Knowledge Bundle Patch

Exact-text SEARCH/REPLACE patching shared by knowledge bundle implementations and MCP adapters.

```ts
import { applyExactTextPatch } from '@open-knowledge/knowledge-bundle-patch'

const updated = applyExactTextPatch('# Draft\n', [{ oldText: '# Draft', newText: '# Published' }])
```

## Contract

`applyExactTextPatch(source, edits)` accepts one to 100 edits and at most 262,144 combined old/new
UTF-16 code units. It rejects empty search text, identical old/new text, and unpaired UTF-16
surrogates.

Edits run sequentially. Each `oldText` must occur exactly once in the current intermediate text;
missing and repeated matches fail with the one-based edit number. Matching is literal and does not
normalize whitespace, Unicode, or line endings. A later edit may target text produced by an earlier
edit.

The function returns a result only after every edit succeeds and never mutates `source`. Storage
backends remain responsible for preconditions, size limits, locking, and atomic commit.
