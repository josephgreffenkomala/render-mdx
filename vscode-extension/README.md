# render-mdx Preview for VS Code

Preview `.mdx` files with the render-mdx visual style without starting a local server.

## Features

- Preview button in the editor title bar for `.mdx` files.
- Side-by-side preview that refreshes from unsaved editor changes.
- Beautiful equivalents for the components imported from `@mdx-components`.
- Mermaid fenced diagrams.
- Contextual revision notes written into the source MDX through VS Code's edit model.
- Note deletion and normal VS Code undo/redo.

Supported components are `Aside`, `Badge`, `Card`, `CardGrid`, `Code`,
`CodeWalkthrough`, `CodeWalkthroughStep`, `FileTree`, `Icon`, `LinkButton`,
`LinkCard`, `Steps`, `TabItem`, and `Tabs`.

The preview accepts imports from `@mdx-components`. Local Astro components and
imports from other packages are intentionally rejected because they cannot run in
the standalone webview.

## Develop

```bash
cd vscode-extension
npm install
npm run check
```

Open `vscode-extension/` in VS Code, press `F5`, open an `.mdx` file in the
Extension Development Host, and click the preview icon in the editor title bar.

Build an installable package with:

```bash
npm run package
```
