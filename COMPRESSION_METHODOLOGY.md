# HTML Compression Methodology for Userscript Development

## Overview

This document describes an intelligent compression strategy for HTML that preserves the "essence" needed to write robust userscripts while aggressively removing noise. The goal is to produce output that an LLM can quickly understand and use for DOM manipulation.

---

## Core Principles

### 1. Userscripts Need Stability
Userscripts must target elements that won't change between page loads or site updates. Therefore:
- **Semantic class names** (e.g., `video-title`, `user-avatar`) = KEEP
- **Generated/hashed class names** (e.g., `css-1a2b3c4`, `_3xK9pQ`) = REMOVE
- **Meaningful IDs** (e.g., `search-input`, `main-content`) = KEEP  
- **Generated IDs** (e.g., `d2l_1_7_757`, `ember1234`) = REMOVE

### 2. Structure Over Content
For userscripts, understanding *how* elements are organized matters more than their exact content:
- Element hierarchy matters
- Repeated patterns can be summarized
- Inline content (text nodes) can often be truncated

### 3. Less is More
The compressed output should be:
- Small enough to fit in context windows
- Clear enough that element selection strategies are obvious
- Complete enough that no guesswork is needed for targeting

---

## Phase 1: Complete Removal

### Remove Entirely (these provide zero value for userscripts)

| Element/Attribute                            | Reason                                      |
| -------------------------------------------- | ------------------------------------------- |
| `<script>` tags                              | JavaScript irrelevant for DOM targeting     |
| `<style>` tags                               | CSS irrelevant for DOM targeting            |
| `<link rel="stylesheet">`                    | External CSS reference                      |
| `<meta>` tags                                | Page metadata                               |
| `<noscript>`                                 | Fallback content                            |
| `<!-- comments -->`                          | Developer notes                             |
| Inline SVG content                           | Visual noise; replace with `<svg>...</svg>` |
| Inline `style=""` attributes                 | Presentation only                           |
| Event handlers (`onclick`, `onload`, etc.)   | JavaScript                                  |
| `data-*` attributes with long encoded values | Serialized state                            |

---

## Phase 2: Detect and Remove Generated Identifiers

### Heuristics for "Generated" Class Names / IDs

A class or ID is likely generated if it matches any of these patterns:

1. **Hash-like suffix**: Ends with random alphanumeric (e.g., `Button_abc123`, `css-1xyz9ab`)
2. **Underscore + numbers**: Pattern like `_1234` or `d2l_1_7_757`
3. **Camel/snake + hash**: `someClass-a1b2c3d4`
4. **Pure gibberish**: No recognizable words, high consonant density
5. **Framework patterns**:
   - Emotion/styled-components: `css-[hash]`
   - CSS Modules: `[name]_[hash]`
   - Tailwind JIT: Very long class lists
   - Angular: `_ngcontent-xxx-c123`
   - Ember: `ember[number]`

### Detection Algorithm

```
function isGeneratedIdentifier(name: string): boolean {
  // Pattern 1: Contains hash-like segments (6+ alphanumeric after delimiter)
  if (/[-_][a-z0-9]{6,}$/i.test(name)) return true;
  
  // Pattern 2: Mostly numbers or single letters
  if (/^[a-z]?\d+$|^\d+[a-z]?$/i.test(name)) return true;
  
  // Pattern 3: Framework-specific patterns
  if (/^(css|sc|styled|emotion)-/i.test(name)) return true;
  if (/^_?ng(content|host)-/i.test(name)) return true;
  if (/^ember\d+$/i.test(name)) return true;
  
  // Pattern 4: High entropy / random-looking
  // Calculate ratio of consonant clusters to word-like patterns
  const words = name.split(/[-_]/);
  const unpronounceable = words.filter(w => 
    !/^[a-z]+$/i.test(w) || // Not pure letters
    /[bcdfghjklmnpqrstvwxz]{4,}/i.test(w) // Consonant cluster
  );
  if (unpronounceable.length > words.length * 0.5) return true;
  
  return false;
}
```

### Semantic Class Name Indicators (KEEP these)

- Contains recognizable English words: `navigation`, `header`, `item`, `button`
- BEM-style naming: `block__element--modifier`
- Common UI patterns: `is-active`, `has-children`, `no-scroll`
- Framework component names: `MuiButton-root`, `ant-input`

---

## Phase 3: Structural Deduplication

### Problem: Repetitive Markup

Many pages have repeated structures:
- Lists of videos, products, comments
- Navigation items
- Card components

### ⚠️ Critical: Preserve Content Variance

**Why aggressive deduplication can be dangerous:**

When items have **badges, labels, or status indicators** that vary between them, collapsing to a single example loses crucial information for userscripts.

Example: A YouTube video list might have:
- Video 1: badge "New"
- Video 2: (no badge)
- Video 3: badges "Members only" + "YouTube featured"

If we only show Video 1 as the "representative example," we lose the "Members only" badge entirely - which might be the exact thing a userscript needs to target!

### Solution: Content-Aware Deduplication

**Step 1: Extract unique badge/label content from each item**

Badge indicators to look for:
- Elements with classes containing: `badge`, `label`, `tag`, `chip`, `status`, `indicator`
- Text like: "Members only", "Live", "New", "Premium", "Verified", etc.
- Attributes: `aria-label`, `title`, `placeholder` (crucial for interactive elements)

**Step 2: Group items by structural signature AND badge content**

- Items with identical structure AND identical badges → can be deduplicated
- Items with identical structure BUT different badges → show each badge variation

**Step 3: Output with badge summary**

Instead of showing just one example:
```html
<!-- REPEATED: 50x .video-item -->
<!-- Badge variations: "New" (10x), "Members only" (5x), "Live" (2x), (none: 33x) -->
<div class="video-item">
  <!-- Structure example with all possible badge locations -->
  <div class="badge">New</div>
  <div class="badge badge--commerce">Members only</div>
</div>
```

### Conservative Deduplication Rules

1. **Identify Repeated Parents**: Find elements with 3+ children of same tag/class
2. **Extract Badge Content**: For each child, find all badge/label text content
3. **Group by Badge Signature**: Group children by their set of badge texts
4. **Preserve Badge Diversity**: 
   - If all items have same badges → show one example with count
   - If badges vary → show one example PER unique badge set, or list all badge variations in a comment
5. **Err on Side of Caution**: When in doubt, preserve more rather than less

---

## Phase 4: Attribute Filtering

### Attributes to REMOVE

| Attribute                                  | Reason               |
| ------------------------------------------ | -------------------- |
| `style`                                    | Inline CSS           |
| `onclick`, `onmouseover`, etc.             | Event handlers       |
| `width`, `height` on non-semantic elements | Layout only          |
| `xmlns`                                    | XML namespace        |
| `draggable`, `spellcheck`                  | Browser behavior     |
| Long `data-*` with encoded JSON/base64     | Serialized app state |

### Attributes to KEEP

| Attribute                     | Reason               |
| ----------------------------- | -------------------- |
| `class` (filtered)            | Element selection    |
| `id` (filtered)               | Element selection    |
| `data-*` (short, descriptive) | App/element state    |
| `href`, `src`                 | Navigation/resources |
| `type` (inputs)               | Element behavior     |
| `name`                        | Form fields          |
| `role`, `aria-label`          | Sometimes semantic   |
| `title`                       | Useful text content  |
| `placeholder`                 | Form hints           |

---

## Phase 5: Content Compression

### Text Node Handling

- **Short text** (<100 chars): Keep as-is
- **Long text**: Truncate to ~50 chars + `...`
- **Repeated identical text**: Show once with count

### Image/Media Elements

```html
<!-- Before -->
<img src="https://example.com/very/long/path/to/image.jpg?with=many&query=params" alt="Description">

<!-- After -->
<img src="[img]" alt="Description">
```

### Inline SVG

```html
<!-- Before -->
<svg xmlns="..." viewBox="..." width="24" height="24">
  <path d="M12 4a2 2 0 100 4..."></path>
</svg>

<!-- After -->
<svg>[icon]</svg>
```

---

## Phase 6: Output Formatting

### Indentation
- Use consistent 2-space indentation
- Collapse empty elements: `<div class="spacer"></div>`

### Comments for Context
Add synthetic comments for:
- Repeated structures: `<!-- REPEATED: 15x .list-item -->`
- Removed content: `<!-- [50 more navigation items] -->`
- Placeholders: `<!-- [sidebar content] -->`

---

## Example Transformation

### Before (YouTube-like)

```html
<yt-lockup-view-model class="ytd-item-section-renderer lockup yt-lockup-view-model--wrapper">
  <div class="yt-lockup-view-model yt-lockup-view-model--horizontal content-id-rSandtI85XQ yt-lockup-view-model--compact">
    <yt-touch-feedback-shape aria-hidden="true" class="yt-spec-touch-feedback-shape yt-spec-touch-feedback-shape--touch-response">
      <div class="yt-spec-touch-feedback-shape__stroke"></div>
      <div class="yt-spec-touch-feedback-shape__fill"></div>
    </yt-touch-feedback-shape>
    <a href="/watch?v=rSandtI85XQ" class="yt-lockup-view-model__content-image" style="width: 168px">
      <yt-thumbnail-view-model class="ytThumbnailViewModelHost ytThumbnailViewModelAspectRatio16By9">
        <div class="ytThumbnailViewModelImage">
          <img src="https://i.ytimg.com/vi/rSandtI85XQ/hqdefault.jpg?sqp=..." alt="" class="ytCoreImageHost ytCoreImageFillParentHeight ytCoreImageFillParentWidth ytCoreImageContentModeScaleAspectFill ytCoreImageLoaded"/>
        </div>
        <!-- ... more nested content ... -->
      </yt-thumbnail-view-model>
    </a>
    <!-- ... metadata, badges, buttons ... -->
  </div>
</yt-lockup-view-model>
```

### After (Compressed)

```html
<!-- REPEATED: 3x yt-lockup-view-model (video items) -->
<yt-lockup-view-model class="lockup">
  <div class="yt-lockup-view-model--horizontal" data-id="rSandtI85XQ">
    <a href="/watch?v=rSandtI85XQ" class="yt-lockup-view-model__content-image">
      <yt-thumbnail-view-model>
        <img src="[thumbnail]" alt="">
        <badge-shape class="yt-badge-shape--thumbnail-badge">
          <div class="yt-badge-shape__text">3:00:22</div>
        </badge-shape>
      </yt-thumbnail-view-model>
    </a>
    <div class="yt-lockup-view-model__metadata">
      <h3 class="yt-lockup-metadata-view-model__heading-reset">
        <a href="/watch?v=rSandtI85XQ" class="yt-lockup-metadata-view-model__title">
          <span>TJ Miller on TYSO - #337</span>
        </a>
      </h3>
      <span class="yt-content-metadata-view-model__metadata-text">Rick Glassman</span>
      <span class="yt-content-metadata-view-model__metadata-text">94K views</span>
      <span class="yt-content-metadata-view-model__metadata-text">2 days ago</span>
      <button class="yt-spec-button-shape-next--icon-button" aria-label="More actions">
        <svg>[icon]</svg>
      </button>
    </div>
  </div>
</yt-lockup-view-model>
```

---

## Implementation Priorities

### Phase 1 (MVP)
1. Remove script/style/meta/noscript/comments
2. Remove inline styles and event handlers
3. Collapse inline SVGs
4. Collapse whitespace

### Phase 2 (Generated ID Detection)
1. Implement heuristic classifier for class/ID names
2. Strip generated classes while keeping semantic ones
3. Add configuration for framework-specific patterns

### Phase 3 (Structural Dedup)
1. Detect repeated sibling structures
2. Emit summary comments + single example
3. Handle nested repetition

### Phase 4 (Polish)
1. Truncate long text content
2. Simplify URLs/image paths
3. Clean attribute values
4. Format output nicely

---

## Configuration Options (Future)

```typescript
interface CompressOptions {
  // What to remove
  removeScripts: boolean;       // default: true
  removeStyles: boolean;        // default: true
  removeSvgContent: boolean;    // default: true
  removeAriaAttributes: boolean; // default: false (sometimes useful)
  
  // Generated identifier handling
  stripGeneratedClasses: boolean; // default: true
  stripGeneratedIds: boolean;     // default: true
  customGeneratedPattern?: RegExp; // e.g., /^css-|^sc-/
  
  // Structural compression
  deduplicateRepeated: boolean;  // default: true
  minRepeatCount: number;        // default: 3
  
  // Content handling  
  maxTextLength: number;         // default: 100
  simplifyUrls: boolean;         // default: true
}
```

---

## Testing Strategy

Create test cases for:
1. **YouTube** - Custom web components, nested structures
2. **React/Next.js** - CSS-in-JS, hydration markers
3. **Angular** - ng-* directives, component selectors
4. **WordPress** - Plugin class soup
5. **Shopify** - Liquid template markers
6. **SPA dashboards** - Complex nested layouts

For each, verify:
- Essential targeting info preserved
- Compression ratio >70% for verbose pages
- Output remains valid, parseable HTML
