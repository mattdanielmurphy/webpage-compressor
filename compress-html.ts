#!/usr/bin/env node

import * as cheerio from "cheerio"

import clipboard from "clipboardy"
import { readFile } from "fs/promises"

async function compressHtml(filePath: string): Promise<void> {
	try {
		// Read the HTML file
		const html = await readFile(filePath, "utf-8")

		// Parse the HTML
		const $ = cheerio.load(html)

		// Remove script and style tags
		$("script, style").remove()

		// Get the compressed HTML and clean up whitespace
		const compressedHtml = $.html()
			.replace(/^\s*[\r\n]/gm, "") // Remove empty lines
			.replace(/\s+/g, " ") // Collapse whitespace (optional, but good for compression)
			.trim()

		// Copy to clipboard
		await clipboard.write(compressedHtml)

		// Show character counts
		const originalLength = html.length
		const compressedLength = compressedHtml.length
		const reductionPercent = ((originalLength - compressedLength) / originalLength) * 100

		console.log(`Original: ${originalLength.toLocaleString()} characters`)
		console.log(`Compressed: ${compressedLength.toLocaleString()} characters`)
		console.log(`Reduction: ${reductionPercent.toFixed(1)}%`)
		console.log("\n✓ Compressed HTML copied to clipboard!")
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			console.error(`Error: File '${filePath}' not found`)
		} else if (error instanceof Error) {
			console.error(`Error: ${error.message}`)
		} else {
			console.error("An unknown error occurred")
		}
		process.exit(1)
	}
}

if (process.argv.length !== 3) {
	console.log("Usage: npx ts-node --esm compress-html.ts <html_file>")
	process.exit(1)
}

compressHtml(process.argv[2]!)
