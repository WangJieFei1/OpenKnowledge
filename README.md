# Open Knowledge

Open Knowledge is a desktop app for writing and searching Markdown files. Open a folder to get started. Files stay where they are, so you can keep using your editor, Git repository, or backup.

I use it for everyday data analysis: I keep dataset notes, SQL, metric definitions, and results together so I can check where a number came from.

## Getting started

Open Knowledge currently ships as source code; there are no prebuilt installers yet. See [Build from source](#build-from-source), [macOS first launch](apps/open-knowledge/docs/macos.md#first-launch-and-folder-access), or [Windows setup](apps/open-knowledge/docs/windows.md).

In the app, click **Open folder** and pick a Markdown folder. Writing and search work without an account or an MCP connection. To try the checkout example, open `examples/checkout-conversion/workspace`.

## Example: explain a change in checkout conversion

Here is a synthetic example of how I connect four Markdown notes in one workspace:

| Note | What it records |
| --- | --- |
| [Dataset notes](examples/checkout-conversion/workspace/dataset.md) | The source table, what one session represents, the UTC time field, and which traffic to exclude. |
| [SQL](examples/checkout-conversion/workspace/query.md) | How to count paid and eligible sessions by week. The query links back to the dataset and the metric definition. |
| [Metric definition](examples/checkout-conversion/workspace/metric.md) | **Checkout conversion = paid eligible checkout sessions ÷ eligible checkout sessions.** Keep the denominator, exclusions, and reporting window explicit. |
| [Analysis conclusion](examples/checkout-conversion/workspace/conclusion.md) | **420 / 10,000 (4.2%)** versus **350 / 10,000 (3.5%)** the previous week: **up 0.7 percentage points**. The note links back to the SQL and the definition. The increase does not establish why conversion changed. |

I run the SQL in my usual analytics environment and save the result in the conclusion note. Later, when I ask “Did conversion improve, and are the two weeks comparable?”, I can send the relevant line ranges from those four notes through MCP instead of pasting four complete notes. The cited lines show the inputs, the denominator, and the result. The app retrieves the notes; the SQL runs in the analytics environment.

**Token count for this example:** One MCP call for the four cited passages used **1,169 tokens**.
Four separate excerpt calls used 1,509, and pasting the full notes used 2,134. If the notes
already contain only the needed passages, pasting is cheaper (795 versus 1,161). These are local
`o200k_base` counts of the question, tool arguments, and results—not whole-chat usage.
[Reproduce the benchmark](examples/checkout-conversion/README.md#reproduce-the-count).

## Editing and search

- Edit Markdown as rich text or source. Open supported documents in a read-only preview.
- Search across a folder in the app. For keyword and meaning-based search from another local tool, connect it over MCP. Results include the source file and line numbers.
- In the optional Codex edition, you can also search local conversations for a selected project. This is off by default.

The **General edition** is the default. Share folders one at a time in **MCP Settings**. A shared folder is read-only until you explicitly enable editing. See [editions and access controls](apps/open-knowledge/docs/editions.md).

## Build from source

You need Bun 1.4.0 and Node.js 22.17 or newer. On macOS, install the Xcode Command Line Tools for native build dependencies. From the repository root:

```sh
bun install --frozen-lockfile
cd apps/open-knowledge
bun run dev
```

Open an existing Markdown folder to get started. The first build downloads the semantic model; subsequent inference runs locally without an embedding API. This release includes source code, not prebuilt installers.

Run `bun test apps/open-knowledge pkgs` for tests and `bun run check` for type checks from the repository root.

## Documentation

[Development and packaging](apps/open-knowledge/docs/development.md) · [Workspace format](apps/open-knowledge/docs/open-knowledge-format.md) · [MCP setup](apps/open-knowledge/docs/mcp.md) · [Retrieval behavior](apps/open-knowledge/docs/retrieval-quality.md)

## License

Open Knowledge is available under the [MIT License](LICENSE).
