module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  prefix: 'tw-', important: '.sp-shell', corePlugins: { preflight: false },
  theme: { extend: {
    colors: { canvas: 'var(--sp-canvas)', sidebar: 'var(--sp-sidebar)', ink: 'var(--sp-ink)', muted: 'var(--sp-muted)', line: 'var(--sp-line)', hover: 'var(--sp-hover)' },
    fontFamily: { sans: ['-apple-system','BlinkMacSystemFont','Segoe UI','PingFang SC','sans-serif'] },
  } },
};
