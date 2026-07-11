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

Open the web interface, browse for a `.md` or `.mdx` file, and click it to save
its path in `~/.render-mdx/config.json`. Saved files are listed on the home page
with an Open button that renders the MDX, and a Remove button to forget a path.
Only individual files are saved — directories are not supported. While the
command is running, changes to saved files are mirrored into the renderer
automatically.

Rendered documents are listed in the standard left sidebar for one-click
navigation. Hover a content block or Starlight component and click **+ Note**
to attach feedback. The renderer writes that feedback directly to the
registered source file under a visible `## Revision notes` section, including
the section hierarchy, block type, ordinal, and a short excerpt. When rendered,
notes are placed back beside their matched content block. This keeps revision
requests precise and available to agents that later edit the MDX.

Inline notes are collapsed by default. Expand one to read the feedback or use
**Delete note** to remove that exact annotation from the source MDX.

You can also add files when starting:

```bash
render-mdx ./notes/example.mdx ./docs/intro.md
```
