# webpage-compressor

## Purpose
CLI tool to intelligently compress HTML for LLM consumption, specifically for writing userscripts.

## Key Files
- `compress-html.ts` - Main compressor script (TypeScript)
- `COMPRESSION_METHODOLOGY.md` - Detailed strategy for intelligent compression

## Commands
- `pnpm run build` - Build the project
- `npx tsx compress-html.ts [input] [output]` - Run locally
- `compress-html` - Run globally (after `pnpm add -g .`)

## Tech Stack
- TypeScript, pnpm
- cheerio for HTML parsing
- clipboardy for clipboard I/O

## Goals
- Extract the "essence" of HTML for userscript development
- Preserve: semantic class names, IDs, data attributes, structure
- Remove: scripts, styles, generated/random IDs, inline SVGs, repetitive markup
- Collapse repetitive structures into summary + example
