import postcss from 'postcss';

// SDK rules already use the univer- namespace. Restrict its two global reset
// blocks and unprefixed arbitrary utilities without rewriting published SDKs.
// Namespace-qualified portal roots are included because SDK popovers may portal
// outside the editor seat. None of these selectors target native DSH controls.
const roots = ':where(.sp-sdk, .sp-sdk *, [class*="univer-"], [class*="univer-"] *)';
export function scopeSdkCss(css) {
  const root = postcss.parse(css);
  root.walkRules(rule => {
    if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    rule.selectors = rule.selectors.map(selector => {
      if (selector.includes('univer-')) return selector;
      if (selector === '*') return roots;
      if ([':before', ':after', '::backdrop'].includes(selector)) return roots + (selector.startsWith('::') ? selector : ':' + selector);
      return `.sp-sdk ${selector}`;
    });
  });
  return root.toString();
}
