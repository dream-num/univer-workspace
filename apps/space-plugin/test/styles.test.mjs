import assert from 'node:assert/strict';
import { test } from 'node:test';
import postcss from 'postcss';
import { readFile } from 'node:fs/promises';
import { scopeSdkCss } from '../scripts/scope-sdk-css.mjs';

test('published SDK resets and arbitrary utilities cannot target native DSH controls', async () => {
 for(const preset of ['preset-docs-core','preset-sheets-core']) {
  const css=await readFile(`node_modules/@univerjs/${preset}/lib/index.css`,'utf8');
  const scoped=postcss.parse(scopeSdkCss(css));
  scoped.walkRules(rule=>{
   if(rule.parent.type==='atrule'&&/keyframes$/.test(rule.parent.name))return;
   for(const selector of rule.selectors) assert.ok(selector.includes('.sp-sdk')||selector.includes('univer-'),selector);
  });
  assert.ok(scoped.toString().includes('scrollbar-color: initial'));
 }
});
test('scoping preserves namespace selectors and keyframes',()=>{
 const css=scopeSdkCss('* { --univer-tw-ring: 0; } .univer-button:hover { color: blue; } @keyframes univer-spin { to { transform:rotate(360deg); } }');
 assert.ok(css.includes('.univer-button:hover'));
 assert.ok(css.includes('to { transform:rotate(360deg); }'));
 assert.equal(/^\*\s*\{/m.test(css),false);
});
