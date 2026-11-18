# Open Knowledge Format

The application edits ordinary Markdown without requiring Open Knowledge Format (OKF) conformance. It enables OKF metadata in detected OKF subtrees or projects with strict mode enabled. Workspace file and folder link assists remain available to ordinary Markdown documents regardless of OKF detection.

Detection requires a non-empty string `okf_version` in a folder's `index.md`. That folder becomes a bundle root for its descendants, without affecting siblings. In that scope, non-reserved documents with parseable frontmatter and a non-empty string `type` receive concept-specific controls. Unversioned Markdown and generic YAML remain editable without OKF labeling. Detection never blocks opening or saving.

Strict mode reports a non-blocking editor error when a non-reserved concept lacks parseable YAML frontmatter or a non-empty string `type`; unknown type values remain valid. When structured editing is safe, the error opens the frontmatter editor. Strict mode does not rewrite documents.

## Bundle model

- A workspace root is one knowledge bundle. No manifest or database is required.
- Every non-reserved `.md` file recursively below the root is a concept document.
- `index.md` and `log.md` are reserved at every directory level and are not concepts.
- A concept starts with YAML frontmatter.
- Unknown types and unknown metadata fields are valid and must survive editing.
- Ordinary Markdown links form the knowledge graph. Broken links remain valid.
- A concept's interoperable identity is its bundle-relative path without `.md`; rename or move changes that identity.

Known OKF properties are editor suggestions, not a whitelist. Property names, `type` values, and value shapes remain producer-defined.

## New documents

Non-reserved documents created in strict projects or detected OKF scopes receive `type: note`, a title derived from the filename, `status: draft`, and a matching H1. Reserved `index.md` and `log.md` files receive only the H1 in those scopes. Documents created elsewhere start empty.

## Editor behavior

The app edits bundle files directly and supports normal Git workflows. Recognized values receive richer controls; unknown content remains accessible.

Body edits preserve parseable frontmatter. Property edits preserve unrelated YAML. Rich text and source editing are always the user's choice: rich edits may normalize Markdown syntax, while source mode edits exact text. Invalid or unusual frontmatter is treated as ordinary Markdown in rich mode and disables structured property controls until repaired.

OKF does not specify rename/move link rewriting, attachments, symlink semantics, redirects, or stable IDs beyond paths. Document those features as editor behavior, not format conformance.

Primary reference: [Open Knowledge Format specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).
