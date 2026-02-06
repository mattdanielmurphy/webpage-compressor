# webpage-compressor

A CLI tool to compress HTML by removing scripts, styles, and extra whitespace.

## Installation

To use this tool anywhere on your system:

1. Build the project:
   ```bash
   pnpm run build
   ```
2. Link or install globally:
   ```bash
   pnpm add -g .
   ```

## Usage

```bash
compress-html [input-html-file] [output-html-file]
```

- **No arguments**: 
  1. Tries to read HTML from your **clipboard**.
  2. If the clipboard is empty or doesn't look like HTML, it **prompts** you for a file path.
  3. Result is copied back to the **clipboard**.
- **One argument** (`<input>`): 
  - Reads from the file and copies the result to the **clipboard**.
- **Two arguments** (`<input> <output>`): 
  - Reads from the input file and writes to the **output** file.

## Development

To run locally without installing:
```bash
npx tsx compress-html.ts [input] [output]
```
