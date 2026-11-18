# Knowledge Bundle Filesystem

Node filesystem implementation of `EditableKnowledgeBundle`. Its public API uses canonical
bundle-scoped absolute paths while a small boundary conversion keeps the confined filesystem
helpers relative to the selected root. It rejects symbolic links and unsafe hard links inside the
editable boundary, validates every portable path segment, performs durable file replacement, and
emits portable bundle change events. Creation is exclusive and never follows a pre-existing
symlink or replaces an entry. Linux creation is anchored to held root and parent descriptors;
other platforms revalidate root, parent, and created-entry identity around each operation. As with
ordinary same-user filesystem APIs, the non-Linux fallback does not claim confinement against a
separate process that has equivalent filesystem authority and races path replacement during the
operation.
Exact-text patches run under the same mutation queue, validate all anchors and preconditions in
memory, and use one atomic replacement only after the full patch succeeds.

This is currently a private source-export workspace package and is bundled by the application.
