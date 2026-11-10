declare module '*.css' { const content: string; export default content; }
declare module '*.scss' { const classes: Readonly<Record<string, string>>; export default classes; }
