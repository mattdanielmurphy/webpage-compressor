#!/usr/bin/env node

import * as cheerio from "cheerio"
import * as readline from "readline"

import { readFile, writeFile } from "fs/promises"

import { Element } from "domhandler"
import clipboard from "clipboardy"

// ============================================================================
// Configuration
// ============================================================================

interface CompressOptions {
	// What to remove completely
	removeScripts: boolean
	removeStyles: boolean
	removeComments: boolean
	removeMeta: boolean
	removeNoscript: boolean
	removeSvgContent: boolean

	// Attribute handling
	removeInlineStyles: boolean
	removeEventHandlers: boolean
	removeAriaAttributes: boolean
	stripGeneratedClasses: boolean
	stripGeneratedIds: boolean

	// Structural compression
	deduplicateRepeated: boolean
	minRepeatCount: number

	// Content handling
	maxTextLength: number
	simplifyUrls: boolean
}

const defaultOptions: CompressOptions = {
	removeScripts: true,
	removeStyles: true,
	removeComments: true,
	removeMeta: true,
	removeNoscript: true,
	removeSvgContent: true,

	removeInlineStyles: true,
	removeEventHandlers: true,
	removeAriaAttributes: false, // Sometimes useful for targeting
	stripGeneratedClasses: true,
	stripGeneratedIds: true,

	deduplicateRepeated: true,
	minRepeatCount: 3,

	maxTextLength: 100,
	simplifyUrls: true,
}

// ============================================================================
// Generated Identifier Detection
// ============================================================================

/**
 * Checks if a string segment looks like a human-authored word.
 */
function isWordLike(segment: string): boolean {
	if (!segment || segment.length < 2) return false
	// Too many digits compared to letters
	const digits = (segment.match(/\d/g) || []).length
	const letters = (segment.match(/[a-z]/gi) || []).length
	if (digits > letters) return false

	// A "word-like" segment has vowels and reasonable letter patterns
	if (!/[aeiouy]/i.test(segment)) return false
	// Too many repeated chars is suspicious
	if (/(.)\1{2,}/.test(segment)) return false
	// Too many consonants in a row is suspicious
	if (/[bcdfghjklmnpqrstvwxz]{4,}/i.test(segment)) return false

	return true
}

/**
 * Determines if a class name or ID looks auto-generated/random
 * rather than human-authored and semantic.
 */
function isGeneratedIdentifier(name: string): boolean {
	if (!name || name.length === 0) return false

	// Known safe/semantic words that should NEVER be flagged as generated
	const safeWords = [
		"content",
		"main",
		"root",
		"wrapper",
		"container",
		"button",
		"label",
		"title",
		"item",
		"active",
		"selected",
		"header",
		"footer",
		"nav",
		"menu",
		"card",
		"modal",
		"dialog",
		"input",
		"text",
		"icon",
		"avatar",
		"user",
		"profile",
		"search",
		"progress",
		"auth",
		"login",
		"signup",
	]
	if (safeWords.some((w) => name.toLowerCase() === w)) return false

	// Pattern 1: Framework-specific prefixes that indicate generated names
	const frameworkPatterns = [
		/^css-[a-z0-9]+$/i, // Emotion, styled-components
		/^sc-[a-z]+$/i, // styled-components
		/^_?ng(content|host)-/i, // Angular
		/^ember\d+$/i, // Ember
		/^__next/i, // Next.js
		/^jsx-[a-z0-9]+$/i, // styled-jsx
		/^svelte-[a-z0-9]+$/i, // Svelte
	]
	if (frameworkPatterns.some((p) => p.test(name))) return true

	// Pattern 2: Ends with hash-like suffix (6+ alphanumeric after - or _)
	// BUT only if it doesn't look like a word
	const match2 = name.match(/[-_]([a-z0-9]{6,})$/i)
	if (match2) {
		const suffix = match2[1]!
		if (!isWordLike(suffix)) return true
	}

	// Pattern 3: Pattern like prefix_NUMBER_NUMBER_NUMBER (e.g., d2l_1_7_757)
	if (/^[a-z]+(_\d+){2,}$/i.test(name)) return true

	// Pattern 4: Just numbers or single letter + numbers
	if (/^[a-z]?\d+$|^\d+[a-z]?$/i.test(name)) return true

	// Pattern 5: Very long class names with lots of dashes (utility class soup)
	const segments = name.split(/[-_]/)
	if (segments.length > 6) return true

	// Pattern 6: Contains sequences that look like hashes
	if (/[a-z]{2,}\d{3,}|[0-9a-f]{8,}/i.test(name)) return true

	// Pattern 7: High "entropy" - lots of consonant clusters or unusual patterns
	const cleanName = name.replace(/[-_]/g, " ").toLowerCase()
	const words = cleanName.split(" ").filter((w) => w.length > 0)

	// If most segments don't look like words, it's probably generated
	const wordLikeCount = words.filter(isWordLike).length

	// If less than 30% of segments look word-like, probably generated
	if (words.length > 2 && wordLikeCount / words.length < 0.3) return true

	return false
}

/**
 * Filter class list, removing generated-looking classes
 */
function filterClasses(classStr: string | undefined, options: CompressOptions): string {
	if (!classStr) return ""
	if (!options.stripGeneratedClasses) return classStr

	const classes = classStr.split(/\s+/).filter((c) => c.length > 0)
	const filtered = classes.filter((c) => !isGeneratedIdentifier(c))

	return filtered.join(" ")
}

// ============================================================================
// Attribute Filtering
// ============================================================================

const eventHandlerAttributes = [
	"onclick",
	"ondblclick",
	"onmousedown",
	"onmouseup",
	"onmouseover",
	"onmouseout",
	"onmousemove",
	"onmouseenter",
	"onmouseleave",
	"onkeydown",
	"onkeyup",
	"onkeypress",
	"onfocus",
	"onblur",
	"onchange",
	"oninput",
	"onsubmit",
	"onreset",
	"onload",
	"onerror",
	"onscroll",
	"onresize",
	"ontouchstart",
	"ontouchmove",
	"ontouchend",
]

const attributesToRemove = ["draggable", "spellcheck", "autocomplete", "autocorrect", "autocapitalize", "translate", "contenteditable", "xmlns", "xml:lang", "xml:space"]

const ariaAttributes = /^aria-/

/**
 * Determines if a data-* attribute should be kept
 * Keep short, descriptive ones; remove long encoded values
 */
function shouldKeepDataAttribute(name: string, value: string): boolean {
	// Remove if value is too long (likely encoded state)
	if (value.length > 100) return false
	// Remove if value looks like encoded data
	if (/^[a-z0-9+/=]{20,}$/i.test(value)) return false
	// Remove if value is JSON-like
	if (/^\s*[\[{]/.test(value) && value.length > 50) return false
	// Keep data-id, data-type, data-state, etc.
	return true
}

// ============================================================================
// Structural Deduplication (Content-Aware)
// ============================================================================

interface ElementSignature {
	tagName: string
	classes: string[]
	childSignature: string
}

/**
 * Selectors and class patterns that indicate badge/label/status elements
 * These contain content that may vary between items and should be preserved
 */
const BADGE_INDICATORS = ["badge", "label", "tag", "chip", "status", "indicator", "pill", "flag", "ribbon", "overlay"]

/**
 * Extract meaningful identifying content from an element to prevent over-aggressive deduplication.
 * Looks for:
 * 1. Badge/label/status classes
 * 2. aria-label, title, placeholder attributes
 * 3. Short, unique text content in interactive elements
 */
function extractBadgeContent($: cheerio.CheerioAPI, el: Element): string[] {
	const $el = $(el)
	const badges = new Set<string>()

	// Helper to add meaningful text
	const addIfMeaningful = (text: string | undefined) => {
		if (text) {
			const trimmed = text.trim()
			if (trimmed.length > 0 && trimmed.length < 60) {
				badges.add(trimmed)
			}
		}
	}

	// 1. Check attributes of the element itself and all descendants
	const elementsToCheck = [
		$el,
		...$el
			.find("*")
			.toArray()
			.map((e) => $(e)),
	]
	elementsToCheck.forEach(($item) => {
		addIfMeaningful($item.attr("aria-label"))
		addIfMeaningful($item.attr("title"))
		addIfMeaningful($item.attr("placeholder"))

		const classStr = ($item.attr("class") || "").toLowerCase()
		const isBadgeElement = BADGE_INDICATORS.some((indicator) => classStr.includes(indicator))
		const isInteractive = ["button", "a", "input", "select", "option"].includes(($item[0] as any).tagName?.toLowerCase())

		if (isBadgeElement || isInteractive) {
			// Get direct text content
			const text = $item.clone().children().remove().end().text().trim()
			addIfMeaningful(text)
		}
	})

	// 2. If it's a very simple structure (like a list of buttons), include the text of the item itself
	if (badges.size === 0) {
		const text = $el.text().trim()
		if (text && text.length < 40) {
			badges.add(text)
		}
	}

	return Array.from(badges).sort()
}

/**
 * Create a structural signature for an element (ignoring content)
 */
function getElementSignature($: cheerio.CheerioAPI, el: Element): string {
	const $el = $(el)
	const tagName = el.tagName?.toLowerCase() || ""
	const classes = ($el.attr("class") || "")
		.split(/\s+/)
		.filter((c) => c)
		.sort()
		.join(",")

	// Get child structure (just tag names and their classes)
	const children = $el.children().toArray()
	const childSigs = children.slice(0, 5).map((child) => {
		const childTag = child.tagName?.toLowerCase() || ""
		const childClass = ($(child).attr("class") || "")
			.split(/\s+/)
			.filter((c) => c)
			.sort()
			.slice(0, 3)
			.join(",")
		return `${childTag}[${childClass}]`
	})

	return `${tagName}[${classes}](${childSigs.join(";")})`
}

/**
 * Find and deduplicate repeated sibling structures
 * CONTENT-AWARE: Preserves items with unique badge/label content
 */
function deduplicateRepeatedStructures($: cheerio.CheerioAPI, options: CompressOptions): void {
	if (!options.deduplicateRepeated) return

	// Find containers with multiple similar children
	$("*").each((_, parent) => {
		const $parent = $(parent)
		const children = $parent.children().toArray()

		if (children.length < options.minRepeatCount) return

		// Group children by structural signature first
		const structuralGroups = new Map<string, Element[]>()
		children.forEach((child) => {
			const sig = getElementSignature($, child)
			if (!structuralGroups.has(sig)) structuralGroups.set(sig, [])
			structuralGroups.get(sig)!.push(child)
		})

		// For groups with enough repetition, apply content-aware deduplication
		structuralGroups.forEach((elements, signature) => {
			if (elements.length >= options.minRepeatCount) {
				// Extract badge content from each element
				const elementsByBadges = new Map<string, Element[]>()
				const badgeSummary = new Map<string, number>() // badge text -> count

				elements.forEach((el) => {
					const badges = extractBadgeContent($, el)
					const badgeKey = badges.join(" | ") || "(none)"

					if (!elementsByBadges.has(badgeKey)) elementsByBadges.set(badgeKey, [])
					elementsByBadges.get(badgeKey)!.push(el)

					// Count individual badges
					if (badges.length === 0) {
						badgeSummary.set("(none)", (badgeSummary.get("(none)") || 0) + 1)
					} else {
						badges.forEach((b) => {
							badgeSummary.set(b, (badgeSummary.get(b) || 0) + 1)
						})
					}
				})

				const first = elements[0]
				if (!first) return

				const $first = $(first)
				const tagName = first.tagName?.toLowerCase() || "element"
				const mainClass = ($first.attr("class") || "").split(/\s+/)[0] || ""
				const descriptor = mainClass ? `.${mainClass}` : tagName

				// Build badge summary string
				const badgeSummaryStr = Array.from(badgeSummary.entries())
					.filter(([badge, _]) => badge !== "(none)")
					.map(([badge, count]) => `"${badge}" (${count}x)`)
					.join(", ")

				// Add summary comment
				let comment = `\n<!-- REPEATED: ${elements.length}x ${descriptor} -->`
				if (badgeSummaryStr) {
					comment += `\n<!-- Badge variations: ${badgeSummaryStr} -->`
				}
				$first.before(comment + "\n")

				// Keep one representative from EACH unique badge combination
				const keptElements = new Set<Element>()

				elementsByBadges.forEach((elsWithSameBadges, badgeKey) => {
					// Keep the first element of each badge combination
					keptElements.add(elsWithSameBadges[0]!)
				})

				// Remove elements that aren't being kept
				elements.forEach((el) => {
					if (!keptElements.has(el)) {
						$(el).remove()
					}
				})
			}
		})
	})
}

// ============================================================================
// Content Compression
// ============================================================================

/**
 * Simplify URLs to placeholders
 */
function simplifyUrl(url: string, type: "image" | "link" | "other"): string {
	if (!url) return url

	// Keep relative paths and short URLs
	if (url.length < 50 && !url.includes("?")) return url

	// For images, use placeholder
	if (type === "image") return "[img]"

	// For links, keep the path but remove query params if long
	try {
		const parsed = new URL(url, "http://example.com")
		if (parsed.search.length > 50) {
			return parsed.pathname
		}
	} catch {
		// Not a valid URL, return truncated
		if (url.length > 80) return url.substring(0, 77) + "..."
	}

	return url
}

/**
 * Truncate long text content
 */
function truncateText(text: string, maxLength: number): string {
	if (!text || text.length <= maxLength) return text
	return text.substring(0, maxLength - 3).trim() + "..."
}

// ============================================================================
// Main Compression Function
// ============================================================================

function compress(html: string, options: CompressOptions = defaultOptions): string {
	const $ = cheerio.load(html, {
		// @ts-ignore - decodeEntities might not be in newer CheerioOptions types but often still works or is handled via xml
		decodeEntities: false,
	} as any)

	// ========================================
	// Phase 1: Remove elements entirely
	// ========================================

	if (options.removeScripts) {
		$("script").remove()
	}

	if (options.removeStyles) {
		$("style").remove()
		$('link[rel="stylesheet"]').remove()
		$('link[rel="preload"][as="style"]').remove()
	}

	if (options.removeMeta) {
		$("meta").remove()
		$('link[rel="icon"]').remove()
		$('link[rel="canonical"]').remove()
		$('link[rel="manifest"]').remove()
		$('link[rel="preconnect"]').remove()
		$('link[rel="dns-prefetch"]').remove()
	}

	if (options.removeNoscript) {
		$("noscript").remove()
	}

	// Remove HTML comments
	if (options.removeComments) {
		$("*")
			.contents()
			.filter(function () {
				return this.type === "comment"
			})
			.remove()
	}

	// ========================================
	// Phase 2: Handle SVG content
	// ========================================

	if (options.removeSvgContent) {
		$("svg").each((_, el) => {
			$(el).empty().append("[icon]")
		})
	}

	// ========================================
	// Phase 3: Filter attributes
	// ========================================

	$(" * ").each((_, node) => {
		const el = node as Element
		if (!el.attribs) return

		const $el = $(el)
		const attribs = el.attribs

		for (const [name, value] of Object.entries(attribs)) {
			const val = value as string
			// Remove inline styles
			if (options.removeInlineStyles && name === "style") {
				$el.removeAttr(name)
				continue
			}

			// Remove event handlers
			if (options.removeEventHandlers && eventHandlerAttributes.includes(name.toLowerCase())) {
				$el.removeAttr(name)
				continue
			}

			// Remove aria attributes (optional)
			if (options.removeAriaAttributes && ariaAttributes.test(name)) {
				$el.removeAttr(name)
				continue
			}

			// Remove other noise attributes
			if (attributesToRemove.includes(name.toLowerCase())) {
				$el.removeAttr(name)
				continue
			}

			// Filter data-* attributes
			if (name.startsWith("data-") && !shouldKeepDataAttribute(name, val)) {
				$el.removeAttr(name)
				continue
			}

			// Filter class attribute
			if (name === "class") {
				const filtered = filterClasses(val, options)
				if (filtered) {
					$el.attr("class", filtered)
				} else {
					$el.removeAttr("class")
				}
				continue
			}

			// Filter id attribute
			if (name === "id" && options.stripGeneratedIds && isGeneratedIdentifier(val)) {
				$el.removeAttr("id")
				continue
			}
		}
	})

	// ========================================
	// Phase 4: Simplify URLs and content
	// ========================================

	if (options.simplifyUrls) {
		$("img").each((_, el) => {
			const $el = $(el)
			const src = $el.attr("src")
			if (src) {
				$el.attr("src", simplifyUrl(src, "image"))
			}
			// Remove srcset as it's usually very verbose
			$el.removeAttr("srcset")
		})

		$("source").each((_, el) => {
			const $el = $(el)
			const src = $el.attr("src") || $el.attr("srcset")
			if (src) {
				$el.attr("src", "[media]")
				$el.removeAttr("srcset")
			}
		})
	}

	// Truncate long text nodes
	$("*")
		.contents()
		.filter(function () {
			return this.type === "text"
		})
		.each((_, node) => {
			if (node.type === "text" && node.data) {
				const trimmed = node.data.trim()
				if (trimmed.length > options.maxTextLength) {
					node.data = truncateText(trimmed, options.maxTextLength)
				}
			}
		})

	// ========================================
	// Phase 5: Structural deduplication
	// ========================================

	deduplicateRepeatedStructures($, options)

	// ========================================
	// Phase 6: Remove empty elements (cleanup)
	// ========================================

	// Remove elements that are purely presentational/empty after stripping
	const emptyPresentationalTags = ["yt-touch-feedback-shape", "div", "span"]

	let changed = true
	while (changed) {
		changed = false
		$(emptyPresentationalTags.join(", ")).each((_, node) => {
			const el = node as Element
			if (!el.attribs) return

			const $el = $(el)
			// Check if element is empty (no meaningful content or children)
			const hasAttributes = Object.keys(el.attribs).length > 0
			const text = $el.text().trim()
			const children = $el.children().length

			// Remove if no attributes, no text, and no children
			if (!hasAttributes && text.length === 0 && children === 0) {
				$el.remove()
				changed = true
			}
		})
	}

	// ========================================
	// Phase 7: Format output
	// ========================================

	let output = $.html()

	// Clean up whitespace
	output = output
		.replace(/^\s*[\r\n]/gm, "") // Remove empty lines
		.replace(/\n\s*\n\s*\n/g, "\n\n") // Collapse multiple blank lines
		.replace(/>\s+</g, ">\n<") // Newline between tags
		.replace(/\t/g, "  ") // Tabs to spaces
		.trim()

	return output
}

// ============================================================================
// CLI Interface
// ============================================================================

async function prompt(question: string): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close()
			resolve(answer.trim())
		})
	})
}

async function run() {
	let html: string = ""
	let inputSource: string = ""
	let outputPath: string | undefined = process.argv[3]

	if (process.argv.length === 2) {
		// Try clipboard first
		const clipboardContent = await clipboard.read()
		if (clipboardContent && (clipboardContent.includes("<html") || clipboardContent.includes("<body") || clipboardContent.includes("</div>") || clipboardContent.includes("</span>"))) {
			html = clipboardContent
			inputSource = "clipboard"
		} else {
			// Ask for file
			const filePath = await prompt("No HTML found on clipboard. Enter input file path: ")
			if (!filePath) {
				console.error("Error: No file path provided")
				process.exit(1)
			}
			html = await readFile(filePath, "utf-8")
			inputSource = filePath
		}
	} else if (process.argv.length >= 3 && process.argv.length <= 4) {
		const filePath = process.argv[2]!
		html = await readFile(filePath, "utf-8")
		inputSource = filePath
	} else {
		console.log("Usage:")
		console.log("  compress-html                         # Try clipboard, then ask for file")
		console.log("  compress-html <input_file>            # Compress file to clipboard")
		console.log("  compress-html <input_file> <output>   # Compress file to output file")
		process.exit(1)
	}

	try {
		const originalLength = html.length
		const compressedHtml = compress(html)
		const compressedLength = compressedHtml.length
		const reductionPercent = ((originalLength - compressedLength) / originalLength) * 100

		if (outputPath) {
			await writeFile(outputPath, compressedHtml, "utf-8")
			console.log(`\n✓ Compressed HTML written to ${outputPath}`)
		} else {
			await clipboard.write(compressedHtml)
			console.log(`\n✓ Compressed HTML (from ${inputSource}) copied to clipboard!`)
		}

		console.log(`Original: ${originalLength.toLocaleString()} characters`)
		console.log(`Compressed: ${compressedLength.toLocaleString()} characters`)
		console.log(`Reduction: ${reductionPercent.toFixed(1)}%`)
	} catch (error) {
		if (error instanceof Error) {
			console.error(`Error: ${error.message}`)
		} else {
			console.error("An unknown error occurred")
		}
		process.exit(1)
	}
}

run()
