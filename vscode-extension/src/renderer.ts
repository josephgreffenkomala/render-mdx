import { evaluate } from '@mdx-js/mdx';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import * as runtime from 'react/jsx-runtime';
import type { Root } from 'mdast';
import { mdxComponents, supportedComponentNames } from './components.js';

type AstNode = {
  type: string;
  children?: AstNode[];
  data?: { estree?: { body?: Array<Record<string, unknown>> } };
};

function validateAndRemoveImports() {
  return (tree: Root) => {
    const root = tree as unknown as AstNode;
    for (const node of root.children ?? []) validateNode(node);
    root.children = (root.children ?? []).filter((node) => node.type !== 'mdxjsEsm' && node.type !== 'yaml');
  };
}

function validateNode(node: AstNode): void {
  if (node.type === 'mdxjsEsm') {
    const statements = node.data?.estree?.body ?? [];
    if (!statements.length) throw new Error('Empty MDX import/export blocks are not supported.');
    for (const statement of statements) {
      if (statement.type !== 'ImportDeclaration') {
        throw new Error('MDX exports are not supported in the preview.');
      }
      const source = statement.source as { value?: unknown } | undefined;
      if (source?.value !== '@mdx-components') {
        throw new Error(`Only imports from '@mdx-components' are supported in the preview.`);
      }
      const specifiers = (statement.specifiers ?? []) as Array<{ imported?: { name?: string }; local?: { name?: string } }>;
      for (const specifier of specifiers) {
        const imported = specifier.imported?.name;
        const local = specifier.local?.name;
        if (!imported || imported !== local || !supportedComponentNames.has(imported)) {
          throw new Error(`Unsupported @mdx-components import: ${local ?? imported ?? 'unknown'}.`);
        }
      }
    }
  }
  for (const child of node.children ?? []) validateNode(child);
}

export async function renderMdx(source: string): Promise<string> {
  const module = await evaluate(source, {
    ...runtime,
    remarkPlugins: [remarkFrontmatter, remarkGfm, validateAndRemoveImports],
    development: false,
  });
  const content = React.createElement(module.default, { components: mdxComponents });
  return renderToStaticMarkup(content);
}
