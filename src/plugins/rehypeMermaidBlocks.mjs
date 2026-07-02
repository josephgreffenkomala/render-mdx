function textContent(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value || '';
  if (!Array.isArray(node.children)) return '';
  return node.children.map(textContent).join('');
}

function hasMermaidClass(node) {
  const className = node?.properties?.className;
  if (!Array.isArray(className)) return false;
  return className.includes('language-mermaid');
}

function visit(parent) {
  if (!parent || !Array.isArray(parent.children)) return;

  for (let index = 0; index < parent.children.length; index += 1) {
    const node = parent.children[index];
    if (
      node?.type === 'element' &&
      node.tagName === 'pre' &&
      Array.isArray(node.children) &&
      node.children[0]?.type === 'element' &&
      node.children[0].tagName === 'code' &&
      hasMermaidClass(node.children[0])
    ) {
      const source = textContent(node.children[0]).trim();
      parent.children[index] = {
        type: 'element',
        tagName: 'mermaid-diagram',
        properties: {
          'data-source': encodeURIComponent(source),
        },
        children: [
          {
            type: 'element',
            tagName: 'pre',
            properties: {
              className: ['mermaid-fallback'],
            },
            children: [
              {
                type: 'element',
                tagName: 'code',
                properties: {
                  className: ['language-mermaid'],
                },
                children: [{ type: 'text', value: source }],
              },
            ],
          },
        ],
      };
      continue;
    }

    visit(node);
  }
}

export default function rehypeMermaidBlocks() {
  return function transform(tree) {
    visit(tree);
  };
}
