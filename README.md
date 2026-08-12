# render-mdx

Local MDX renderer with a web picker and live sync.

## Install

```bash
pip install .
```

Node.js and npm are required because the renderer is an Astro app. On the first run,
`render-mdx` installs the Astro dependencies into `~/.render-mdx/app`.

## Use

```bash
render-mdx
```

Open the web interface and browse for a `.md`/`.mdx` file or a folder. Click a
file to register it directly, or enter a folder and choose **Add this folder** to
register all Markdown documents below it. Saved sources are listed on the home
page with controls to open rendered documents or forget a path. Registered
folders are scanned recursively, so new `.md` and `.mdx` files appear
automatically while the command is running. During recursive scans, nested
hidden folders, hidden files, symlink entries, and `node_modules` are skipped.

Rendered documents are listed in the standard left sidebar for one-click
navigation. Hover a content block or Starlight component and click **+ Note**
to attach feedback. The renderer writes that feedback directly to the
registered source file under a visible `## Revision notes` section, including
the section hierarchy, block type, ordinal, and a short excerpt. When rendered,
notes are placed back beside their matched content block. This keeps revision
requests precise and available to agents that later edit the MDX.

Inline notes are collapsed by default. Expand one to read the feedback or use
**Delete note** to remove that exact annotation from the source MDX.

## VS Code extension

The repository also contains a serverless VS Code preview in `vscode-extension/`.
It adds a preview button to the editor title bar for `.mdx` files, updates from
unsaved editor content, renders the supported `@mdx-components` tags and Mermaid,
and adds or deletes the same source-backed revision notes using VS Code edits.

To develop or package it:

```bash
cd vscode-extension
npm install
npm run check
npm run package
```

See [`vscode-extension/README.md`](vscode-extension/README.md) for the supported
component list and Extension Development Host instructions.

You can also add files when starting:

```bash
render-mdx ./notes/example.mdx ./docs
```

To save source paths without starting the renderer, use the registration command:

```bash
render-mdx register ./notes/example.mdx ./docs
```

`render-mdx add` is an alias for `render-mdx register`. Registered paths are
stored in `~/.render-mdx/config.json`, or in `$RENDER_MDX_HOME/config.json` when
that environment variable is set.

## Install the MDX authoring skill

To install the bundled render-mdx MDX-authoring skill into another project:

```bash
render-mdx install-skill /path/to/project
```

This creates:

```text
/path/to/project/.agents/skills/render-mdx-components/
```

Omit the path to install into the current directory. Use `--force` to replace an
existing installed copy. The skill guides agents while they create or edit MDX
documents that will be rendered with render-mdx; it is not intended as a general
render-mdx repository maintenance workflow.
