import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import rehypeMermaidBlocks from './src/plugins/rehypeMermaidBlocks.mjs';

export default defineConfig({
  site: 'http://localhost:4321',
  integrations: [
    starlight({
      title: 'render-mdx',
      logo: undefined,
      social: undefined,
      components: {
        MarkdownContent: './src/components/CustomMarkdownContent.astro',
        PageFrame: './src/components/CustomPageFrame.astro',
        PageSidebar: './src/components/CustomPageSidebar.astro',
      },
      sidebar: [
        { label: 'Documents', items: [{ autogenerate: { directory: 'rendered', collapsed: false } }] },
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
  markdown: {
    processor: unified({
      rehypePlugins: [rehypeMermaidBlocks],
    }),
    syntaxHighlight: 'shiki',
  },
  vite: {
    resolve: {
      alias: {
        '@mdx-components': fileURLToPath(new URL('./src/components/mdx/index.ts', import.meta.url)),
      },
    },
  },
});
