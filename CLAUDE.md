---
description: Use pnpm instead of Bun or npm.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using pnpm instead of Bun or npm.

- Use `pnpm <command>` for package management.
- Use `npx ts-node` or `pnpm dlx ts-node` to run TypeScript files if not compiled.

## Testing

Use `pnpm test` if tests are implemented.

## Development

To run the script locally:
```bash
npx tsx compress-html.ts <input> [output]
```