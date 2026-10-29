import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import postcss from 'postcss';

const directory = fileURLToPath(new URL('.', import.meta.url));

describe('screen table scroll regions (structural guards, not browser layout tests)', () => {
  it('gives every non-receipt table its own named, keyboard-accessible scroll region', () => {
    let tables = 0;
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.tsx') && !name.includes('.test.') && name !== 'Receipt.tsx')) {
      const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if ((ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'table')
          || (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'table')) {
          tables += 1;
          expect(ts.isJsxElement(node.parent), `${file}: table needs a scroll wrapper`).toBe(true);
          if (!ts.isJsxElement(node.parent)) return;
          const attributes = node.parent.openingElement.attributes.properties
            .filter(ts.isJsxAttribute);
          const attribute = (name: string) => attributes.find((item) => item.name.getText(source) === name)?.initializer;
          const classes = attribute('className');
          expect(classes && ts.isStringLiteral(classes) ? classes.text.split(/\s+/) : [], file).toContain('table-scroll');
          expect(attribute('role')?.getText(source), file).toBe('"region"');
          expect(attribute('aria-label')?.getText(source), file).toMatch(/^".+"$/);
          expect(attribute('tabIndex')?.getText(source), file).toBe('{0}');
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(tables).toBeGreaterThanOrEqual(22);
  });

  it('bounds scrolling, restores visible scrollbars, pins headers and keeps printing unclipped', () => {
    const css = postcss.parse(readFileSync(new URL('../index.css', import.meta.url), 'utf8'));
    const declarations = (selector: string, media?: string) => {
      const result: Record<string, string> = {};
      css.walkRules(selector, (rule) => {
        const parent = rule.parent;
        const context = parent?.type === 'atrule' ? parent.params : undefined;
        if (context !== media) return;
        rule.walkDecls((declaration) => { result[declaration.prop] = declaration.value; });
      });
      return result;
    };
    expect(declarations('.table-scroll')).toMatchObject({
      'max-height': 'min(65vh, 40rem)', overflow: 'auto',
      'scrollbar-width': 'thin', 'scrollbar-gutter': 'stable'
    });
    expect(declarations('.table-scroll-fill')['max-height']).not.toBe('none');
    expect(declarations('.table-scroll-fill', '(min-width: 1024px)')).toMatchObject({ height: '100%', 'max-height': 'none' });
    expect(declarations('.table-scroll::-webkit-scrollbar')).toMatchObject({ display: 'block', width: '8px', height: '8px' });
    expect(declarations('.table-scroll > table > thead')).toMatchObject({ position: 'sticky', top: '0', 'z-index': '30' });
    expect(declarations('.table-scroll', 'print')).toMatchObject({ 'max-height': 'none', overflow: 'visible' });
    expect(declarations('.table-scroll > table > thead', 'print')).toMatchObject({ position: 'static' });
  });

  it('also scrolls the grid-based active staff table without clipping its columns', () => {
    const settings = readFileSync(new URL('./SettingsView.tsx', import.meta.url), 'utf8');
    expect(settings).toContain('role="region" aria-label="Active staff sessions table" tabIndex={0} className="table-scroll"');
    expect(settings).toContain('className="min-w-0 md:min-w-[1200px]"');
    expect(settings).toContain('className="sticky top-0 z-30 hidden md:grid');
  });
});