# Knowledge Bundle API

Type-only contracts for exposing a knowledge bundle through an RPC system such as
[Cap'n Web](https://github.com/cloudflare/capnweb).

## Install

```sh
npm install @open-knowledge/knowledge-bundle-api
```

```ts
import type { ReadonlyKnowledgeBundle } from '@open-knowledge/knowledge-bundle-api'

export function listRoot(bundle: ReadonlyKnowledgeBundle) {
	return bundle.list({ path: '/', depth: 1 })
}
```

`KnowledgeBundle<Metadata, Access>` is the common read interface. Use
`ReadonlyKnowledgeBundle` or `EditableKnowledgeBundle` when the grant is known, and
`KnowledgeBundle` when access is discovered at runtime. `SubscribableKnowledgeBundle` adds optional
change subscriptions.

Metadata, entries, inputs, and mutation results must be acyclic pass-by-value data supported by the
RPC transport. Listeners and subscriptions are capabilities. Methods return promises; Cap'n Web
clients use `RpcStub<T>`, while server implementations extend `RpcTarget`.

File `documentAccess` is a presentation hint. Clients must combine it with the bundle access from
`getInfo()`, and implementations must enforce authorization at runtime.

## Remote Cap'n Web Endpoint

Remote bundle locators use `okb:`:

```text
okb://hostname/path/to/bundle
okb://hostname/path/to/bundle?insecure=true
```

The authority and path identify a Cap'n Web endpoint whose main object is the knowledge bundle.
Clients translate `okb:` to `https:`, or to `http:` only for the exact query parameter
`insecure=true`. Remove `insecure` before the request, retain other query parameters, and reject
fragments, credentials, and repeated `insecure` parameters.

```ts
function capnWebEndpoint(locator: string): URL {
	const candidate = locator.trim()
	if (candidate.includes('#')) {
		throw new TypeError('Fragments are not allowed.')
	}
	const parsed = new URL(candidate)
	if (parsed.protocol !== 'okb:' || !parsed.hostname || parsed.username || parsed.password) {
		throw new TypeError('Expected an okb:// endpoint without a fragment.')
	}
	const insecure = parsed.searchParams.getAll('insecure')
	if (insecure.length > 1) {
		throw new TypeError('Only one insecure parameter is allowed.')
	}
	const protocol = insecure[0] === 'true' ? 'http:' : 'https:'
	const endpoint = new URL(parsed.href.replace(/^okb:/, protocol))
	endpoint.searchParams.delete('insecure')
	return endpoint
}
```

HTTP batch RPC supports every bounded operation:

```ts
import { newHttpBatchRpcSession, type RpcStub } from 'capnweb'
import type { KnowledgeBundle } from '@open-knowledge/knowledge-bundle-api'

const endpoint = capnWebEndpoint('okb://knowledge.example.test/bundles/main')
const request = new Request(endpoint, {
	redirect: 'error',
	signal: AbortSignal.timeout(15_000)
})
using bundle: RpcStub<KnowledgeBundle> = newHttpBatchRpcSession<KnowledgeBundle>(request)
const info = await bundle.getInfo()
```

Use a readonly or editable session type when that grant is known. Subscription support requires a
`SubscribableKnowledgeBundle` session over a persistent bidirectional transport. Do not probe a
Cap'n Web proxy for optional methods; proxies accept arbitrary property names at runtime. Servers
that retain a listener must duplicate its callback stub and dispose that duplicate when the
subscription closes.

Paths are canonical bundle-scoped absolute paths: `/` is the root, and empty, `.` and `..` segments
are invalid. Validate untrusted paths at runtime; the template type checks only the leading slash.
IDs and revisions are opaque and scoped to one bundle.

When a request includes an entry ID, the ID is authoritative. The backend follows relocation and
returns the current canonical path; it must not fall back to a different entry at the stale path.
All supplied revision and content-hash preconditions must match.

## Native Exact-Text Patches

`patchFile` is required on `EditableKnowledgeBundle`. Existing editable endpoints must implement
this wire-contract revision before clients rely on native patching.

```ts
const result = await editableBundle.patchFile({
	id: file.id,
	path: file.path,
	expectedRevision: file.revision,
	expectedContentHash: file.contentHash,
	maximumBytes: 1024 * 1024,
	edits: [{ oldText: '## Draft', newText: '## Published' }]
})
```

Edits run sequentially. Each non-empty `oldText` must occur exactly once in the current intermediate
text; matching does not normalize whitespace, Unicode, or line endings. A request contains one to
100 edits and at most 262,144 combined old/new characters. `maximumBytes`, when present, bounds the
UTF-8 size of both source and result.

Malformed, missing, or ambiguous anchors and exceeded bounds fail without changing content. Patch
failures use `invalid_patch`, `patch_not_found`, `patch_ambiguous`, or `too_large`; anchor failures
include a one-based `editNumber`. The backend must resolve the locator, verify all preconditions,
apply the complete patch in memory, and commit once. See
[`@open-knowledge/knowledge-bundle-patch`](../knowledge-bundle-patch/README.md) for the shared
algorithm.

Retain the `id` and canonical `path` returned by each successful mutation; atomic replacement may
produce a new ID. TypeScript types do not attenuate a runtime capability, so readonly grants must
omit mutation methods or enforce authorization on every mutation.

This package contains declarations only and has no runtime or transport dependency.
