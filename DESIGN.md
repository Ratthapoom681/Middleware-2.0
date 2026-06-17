---
name: DefectDojo Viewer
description: React and Express viewer for DefectDojo and Redmine integration
colors:
  primary: "#6366f1"
  primary-hover: "#4f46e5"
  neutral-bg: "#0f1624"
  neutral-card: "#172033"
  neutral-text: "#f1f4f9"
  neutral-muted: "#9ca8bc"
  border: "#2d3748"
typography:
  display:
    fontFamily: "Prompt, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 3vw, 2.35rem)"
    fontWeight: 800
    lineHeight: 1.1
  body:
    fontFamily: "Prompt, system-ui, sans-serif"
    fontSize: "0.88rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0.5rem"
  md: "0.75rem"
spacing:
  xs: "0.4rem"
  sm: "0.65rem"
  md: "1rem"
  lg: "1.25rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
---

# Design System: DefectDojo Viewer

## 1. Overview

**Creative North Star: "The Cobalt Bunker"**

The DefectDojo Viewer design system serves security engineers and analysts triaging vulnerabilities and syncing state with Redmine. Because these tasks are security-critical, require high focus, and are typically performed in terminal-heavy environments under low ambient light, the UI prioritizes a sleek, dark-slate background with highly focused cobalt/indigo accents. Spacing is dense and structured, maximizing content visibility without feeling cluttered.

The system rejects flashy or distracting visual gradients, excessive border rounding, and low-contrast text. Consistency and predictability are key to reducing cognitive load during incident triage.

**Key Characteristics:**
* Sleek dark theme by default (Cobalt/slate tints).
* Dense information grids using a strict 4px spacing scale.
* Sharp typography hierarchy for immediate scannability.
* Tactile form inputs with responsive focus rings.

## 2. Colors

The palette is composed of high-contrast cobalt blue accents layered over deep slate grays, with vibrant, contrast-optimized threat severities.

### Primary
* **Sleek Cobalt** (#6366f1 / oklch(65% 0.18 250)): Used for primary interactive actions, active sidebar navigation, and focus rings.

### Neutral
* **Deep Space Blue** (#0f1624 / oklch(14% 0.012 250)): The page body background color.
* **Slate Container** (#172033 / oklch(19% 0.016 250)): Card and dashboard section backgrounds.
* **Slate Subtler** (#131a2a / oklch(16% 0.014 250)): Secondary layouts, inputs, and list subsections.
* **Off-White Text** (#f1f4f9 / oklch(96% 0.005 250)): Primary text color for body copy and headings.
* **Muted Gray Text** (#9ca8bc / oklch(78% 0.015 250)): Helper text, metadata labels, and placeholders.
* **Border Slate** (#2d3748 / oklch(26% 0.02 250)): Outer panel borders and structural divisions.

### Threat Levels
* **Critical** (oklch(74% 0.18 20)): Bright coral red.
* **High** (oklch(76% 0.17 45)): Warm orange.
* **Medium** (oklch(84% 0.14 85)): Vibrant amber.
* **Low/Connected** (oklch(82% 0.14 145)): Mint green.

**The Contrast Rule.** Text colors placed over colored backgrounds (such as threat badges or toasts) must hit a minimum of 4.5:1 contrast ratio against their backing.

## 3. Typography

**Display Font:** Prompt, system-ui, -apple-system, sans-serif
**Body Font:** Prompt, system-ui, -apple-system, sans-serif
**Technical Font:** ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace

The typography system relies on shared font tokens, weight contrast, and strict line-heights to differentiate display hierarchies. Use Prompt for normal interface text and the mono stack only for technical values such as logs, JSON, CVEs, endpoints, and identifiers.

### Hierarchy
* **Display** (800, clamp(1.6rem, 3vw, 2.35rem), 1.1): Page heroes and main dashboard titles.
* **Headline** (800, 1.08rem, 1.2): Section titles.
* **Title** (800, 0.95rem, 1.25): Card titles and input subsection group headers.
* **Body** (400, 0.88rem, 1.5): Standard prose and read-only text fields. Line length capped at 75ch.
* **Label** (700, 0.82rem, 1.35): Input field labels and metadata tags.

## 4. Elevation

The elevation system relies primarily on flat, tonal layering (different shades of slate) to establish boundaries. Shadows are used only to isolate popovers and active modals from the screen backdrop.

### Shadow Vocabulary
* **Popover Shadow** (0 20px 25px -5px rgba(0, 0, 0, 0.5)): Used on active dropdown menus, context menus, and modals.
* **Ambient Card Glow** (0 4px 6px -1px rgba(0, 0, 0, 0.4)): Used on container elements to lift them slightly off the background.

**The Flat-By-Default Rule.** Layout panels and cards remain completely flat at rest. Depth is established through border-color contrast and background shade nesting.

## 5. Components

### Buttons
* **Shape:** Softly rounded edges (0.5rem/8px radius).
* **Primary:** Cobalt background (#6366f1), white text. Internal padding of 0.5rem 1rem.
* **Hover / Focus:** Transitions smoothly to a darker cobalt (#4f46e5). Focus rings draw an outer 3px border offset.

### Cards / Containers
* **Corner Style:** Rounded (0.75rem/12px radius).
* **Background:** Slate Container background (#172033).
* **Border:** Slate border (#2d3748), 1px solid.
* **Internal Padding:** Spaced at 1rem.

### Inputs / Fields
* **Style:** Deep Slate Subtler background (#131a2a) with 1px border (#2d3748), rounded corners (0.5rem/8px radius).
* **Focus:** Seamless outline transition to Cobalt border (#6366f1).

## 6. Do's and Don'ts

### Do:
* **Do** use strict tonal backgrounds (`--bg-body`, `--bg-card`, `--bg-subtle`) to build vertical layout hierarchy.
* **Do** use CSS custom properties for color and spacing transitions.
* **Do** verify touch target sizes remain at least 44x44px.

### Don't:
* **Don't** use decorative gradients on text or card backgrounds.
* **Don't** use side-stripe borders (e.g. `border-left` thicker than 1px) to highlight cards or alerts.
* **Don't** mix multiple UI font families. Stick to the Prompt stack, with monospace reserved for technical values.
* **Don't** use card nesting. Establishing card hierarchies inside other cards is prohibited.
