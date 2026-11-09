# Third-party code in src/vendor

These files are copied from the npm packages named below, pinned to one version each, and their bytes are not
modified. Nothing is installed at run time and nothing is fetched: the code layer loads the parser files and the layout
loads ELK from this folder, only when a run needs them. Each package's licence file sits beside its files and is kept.
The package's `test/extract.test.js` checks every file against the sha256 below, so a changed copy fails the tests.

Seven files are kept under another name or in another form, without a change to their bytes:

- Each WebAssembly file `X.wasm` is kept as text, `X.wasm.gz.hex`: the upstream file compressed with gzip (level 9),
  then written as lowercase hex, 120 characters a line. `src/parse-tree.mjs` decodes it when it loads (`wasmBytes`:
  hex to bytes, then gunzip), and the decoded bytes are the upstream file, byte for byte: the sha256 below is the
  upstream file's, checked against the decoded bytes.
- elkjs's `lib/elk.bundled.js` is kept byte for byte as `lib/elk.bundled.cjs`, so Node loads it as CommonJS (it is not
  an ES module) whatever the package around it declares. elkjs's own `package.json` is not kept; the version it names,
  0.12.0, is recorded here.

| Package | Version | Licence | Upstream source | Used for |
|---|---|---|---|---|
| elkjs | 0.12.0 | EPL-2.0 (elkjs is offered as EPL-2.0 OR GPL-3.0-or-later; used here under EPL-2.0) | https://github.com/kieler/elkjs (built from the Eclipse Layout Kernel, https://github.com/eclipse/elk) | Positions of the desktop How graph and the desktop Where code graph (src/graph-elk.mjs) |
| web-tree-sitter | 0.26.13 | MIT | https://github.com/tree-sitter/tree-sitter (lib/binding_web) | The parser runtime, WebAssembly (src/parse-tree.mjs) |
| tree-sitter-javascript | 0.25.0 | MIT | https://github.com/tree-sitter/tree-sitter-javascript | Grammar for .js .mjs .cjs .jsx |
| tree-sitter-typescript | 0.23.2 | MIT | https://github.com/tree-sitter/tree-sitter-typescript | Grammars for .ts .mts .cts and .tsx |
| tree-sitter-python | 0.25.0 | MIT | https://github.com/tree-sitter/tree-sitter-python | Grammar for .py .pyi |
| tree-sitter-go | 0.25.0 | MIT | https://github.com/tree-sitter/tree-sitter-go | Grammar for .go |

elkjs is distributed here in object code form (the compiled `lib/elk.bundled.js` of its npm package, kept as
`lib/elk.bundled.cjs`). Its source code is available from the upstream repositories above (tag 0.12.0 of kieler/elkjs),
under the same licence (`elkjs/LICENSE.md`).

npm tarballs (registry.npmjs.org) and their integrity:

| Tarball | Integrity |
|---|---|
| elkjs-0.12.0.tgz | sha512-YZcKynxVxYoKIOEpywEPwCFdg+BTbxQRNf3pbwdDCvc8O3kQD8bmIwSxKU1eOTVc4Xo+VG9Te+575mlfvOrhEQ== |
| web-tree-sitter-0.26.13.tgz | sha512-5bUZ7vbQ1kcondet96wzP974+JfCZDeQ7bTpacICm2nnvHpa5cO0ByRsoMcAhUP+743vpkb4m0BFlVSm+Ye9VA== |
| tree-sitter-javascript-0.25.0.tgz | sha512-1fCbmzAskZkxcZzN41sFZ2br2iqTYP3tKls1b/HKGNPQUVOpsUxpmGxdN/wMqAk3jYZnYBR1dd/y/0avMeU7dw== |
| tree-sitter-typescript-0.23.2.tgz | sha512-e04JUUKxTT53/x3Uq1zIL45DoYKVfHH4CZqwgZhPg5qYROl5nQjV+85ruFzFGZxu+QeFVbRTPDRnqL9UbU4VeA== |
| tree-sitter-python-0.25.0.tgz | sha512-eCmJx6zQa35GxaCtQD+wXHOhYqBxEL+bp71W/s3fcDMu06MrtzkVXR437dRrCrbrDbyLuUDJpAgycs7ncngLXw== |
| tree-sitter-go-0.25.0.tgz | sha512-APBc/Dq3xz/e35Xpkhb1blu5UgW+2E3RyGWawZSCNcbGwa7jhSQPS8KsUupuzBla8PCo8+lz9W/JDJjmfRa2tw== |

Files (path in this folder: path in its package, sha256 of the upstream file; for a `.wasm.gz.hex` file, of its
decoded bytes):

| File | From | sha256 |
|---|---|---|
| elkjs/LICENSE.md | LICENSE.md | 637e81f4a1b6b4079535c499fca05e238cf7605c1ff5b76d60d7da7ce96700c9 |
| elkjs/lib/elk.bundled.cjs | lib/elk.bundled.js | 1222e44f953ce7746af23801e723708f8e6f436b8b377a6a5fc7552f34a307b3 |
| web-tree-sitter/LICENSE | LICENSE | c5cfb43042b6b72045f4ba997834d0a7786d2793d91680868b5815b39f14fc78 |
| web-tree-sitter/web-tree-sitter.js | web-tree-sitter.js | 0c868236a47296b4ff3c1570f20e0899e4a784ff6e5cd7bfc9c3a55225463e4a |
| web-tree-sitter/web-tree-sitter.wasm.gz.hex | web-tree-sitter.wasm | 99fa2281fc4c6da713ccdadce72e81571b032ab9901b751be2d5aa127c843aaf |
| tree-sitter-javascript/LICENSE | LICENSE | 2e0110e07abef7c2548b26ec9d6969775617ca539a0dc8dbeeb14d6452c711d1 |
| tree-sitter-javascript/tree-sitter-javascript.wasm.gz.hex | tree-sitter-javascript.wasm | 5fb488d0cabb4775a594bab85682de5ad6ce83c0d6ac997a9f82dd084d571240 |
| tree-sitter-typescript/LICENSE | LICENSE | 49bf33cf78ef5897e4e161ce1517df7de1ae5042a65b6bcfd44401e0fc606559 |
| tree-sitter-typescript/tree-sitter-typescript.wasm.gz.hex | tree-sitter-typescript.wasm | 778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d |
| tree-sitter-typescript/tree-sitter-tsx.wasm.gz.hex | tree-sitter-tsx.wasm | 79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8 |
| tree-sitter-python/LICENSE | LICENSE | d724405ce238a22c0d35769c5a36b386ad5958192efe8bbb304fb2896254575f |
| tree-sitter-python/tree-sitter-python.wasm.gz.hex | tree-sitter-python.wasm | 16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47 |
| tree-sitter-go/LICENSE | LICENSE | 2e0110e07abef7c2548b26ec9d6969775617ca539a0dc8dbeeb14d6452c711d1 |
| tree-sitter-go/tree-sitter-go.wasm.gz.hex | tree-sitter-go.wasm | 9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7 |

To update one: take the new version's files from its npm tarball, replace them here whole (a `.wasm` file encoded as
above, `lib/elk.bundled.js` renamed as above), update this file's tables, and run the tests. Never edit a vendored file
in place: renaming a file and encoding a WebAssembly file as text are not edits of its bytes.
