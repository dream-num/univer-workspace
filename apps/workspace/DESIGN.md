---
name: OfficeLab Repository
description: Activity-console visual system for the Workspace Browser's Repository mode (html[data-ui-mode="repository"]).
colors:
  accent: "#7C3AED"
  accent-hover: "#6D28D9"
  accent-text: "#6D28D9"
  accent-soft: "#F3EDFE"
  on-accent: "#FFFFFF"
  accent-dark: "#C8FF00"
  accent-hover-dark: "#D6FF4D"
  accent-text-dark: "#D2FF33"
  accent-soft-dark: "rgba(200,255,0,.09)"
  on-accent-dark: "#0B1000"
  brand: "#FF5A36"
  on-brand: "#FFF4F0"
  ground: "#FFFFFF"
  panel: "#FFFFFF"
  panel-2: "#F5F5F7"
  sunken: "#FAFAFB"
  line: "rgba(12,14,22,.09)"
  line-2: "rgba(12,14,22,.16)"
  ink: "#0A0C12"
  ink-2: "#4F545D"
  ink-3: "#686D76"
  ground-dark: "#03080A"
  panel-dark: "#070C0F"
  panel-2-dark: "#0D1418"
  sunken-dark: "#05090C"
  line-dark: "rgba(255,255,255,.08)"
  line-2-dark: "rgba(255,255,255,.14)"
  ink-dark: "#FCFCFE"
  ink-2-dark: "#A6ADB5"
  ink-3-dark: "#7E868F"
  merged: "#0D9488"
  merged-text: "#0F766E"
  merged-soft: "#E3F5F3"
  merged-dark: "#2DD4BF"
  open: "#15803D"
  open-dark: "#4ADE80"
  warn: "#B45309"
  warn-text: "#92400E"
  warn-soft: "#FEF3E2"
  warn-dark: "#FBBF24"
  danger: "#DC2626"
  danger-text: "#B91C1C"
  danger-soft: "#FDECEC"
  danger-dark: "#F87171"
  kind-sheet: "#16A34A"
  kind-doc: "#0284C7"
  kind-slide: "#EA580C"
  kind-folder: "#5E636B"
  actor-people: "#2F6FEB"
  actor-agents: "#DB2777"
typography:
  display:
    fontFamily: "Plus Jakarta Sans Variable, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "38px"
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: "-0.032em"
  headline:
    fontFamily: "Plus Jakarta Sans Variable, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Plus Jakarta Sans Variable, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.35
  title-sm:
    fontFamily: "Plus Jakarta Sans Variable, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "15.5px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Plus Jakarta Sans Variable, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Plus Jakarta Sans Variable, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Plus Jakarta Sans Variable, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.4
  figure:
    fontFamily: "Geist Mono Variable, ui-monospace, SF Mono, PingFang SC, Microsoft YaHei, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
    fontFeature: "\"tnum\""
rounded:
  xs: "4px"
  badge: "5px"
  sm: "6px"
  tile: "7px"
  control: "8px"
  md: "9px"
  card: "12px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  gutter: "32px"
  section: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-dark:
    backgroundColor: "{colors.accent-dark}"
    textColor: "{colors.on-accent-dark}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "5px 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-2}"
  icon-button:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    size: "34px"
  icon-button-hover:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink}"
  input-search:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 8px 0 11px"
    height: "36px"
  nav-link:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  nav-link-hover:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink}"
  tab-active:
    textColor: "{colors.accent-text}"
    typography: "{typography.body}"
    padding: "11px 12px 13px"
  view-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  count:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink-2}"
    typography: "{typography.figure}"
    rounded: "{rounded.badge}"
    padding: "3px 6px"
  count-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-text}"
  item-card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.card}"
    padding: "15px 20px 14px"
  item-card-hover:
    backgroundColor: "{colors.panel-2}"
  list-frame:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
  list-row:
    padding: "13px 16px"
  list-row-hover:
    backgroundColor: "{colors.panel-2}"
  kind-tile:
    rounded: "{rounded.tile}"
    size: "26px"
  issue-label:
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "22px"
  state-chip-ready:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn-text}"
    rounded: "{rounded.badge}"
    padding: "1px 7px"
---

# Design System: OfficeLab Repository

## Overview

**Creative North Star: "The Activity Console"**

This system governs the Workspace Browser's **Repository mode only**: every token and rule lives under `html[data-ui-mode="repository"]` (light on the root, dark under the nested `.dark` class). Wiki mode keeps its own look and is not part of this world. Repository mode keeps GitHub's habits (top bar search, Code / Issues / Pull requests / Pages / Settings tabs, file table, About panel, issue filters) and dresses them in an OpenRouter-style console: a near-white or near-black ground, hairline borders, one saturated accent, and live figures set in a monospace.

A repository introduces itself with identity and numbers before files: name, copyable slug, Private badge and Star, an inline run of metadata (Members, Files, Last updated), the tabs, then a stacked daily activity chart above the file table. Home leads with a counted headline and a ranked bar list of open work per repository. Density is office-work density: 14px body, 50px file rows, 36px controls. Light is the default appearance, because the audience works in daylit offices; dark is the console variant with electric lime.

The system is flat, quiet and precise. Office content stays the hero; chrome is hairlines and fills one step off the ground.

**Key Characteristics:**
- Two themes, one accent slot: violet in light, lime in dark, never both.
- Flat at rest; one soft shadow, only for floating layers.
- Plus Jakarta Sans for all words; Geist Mono only for figures and identifiers.
- Content kinds tinted on small rounded tiles; people shown as circular initials.
- Hairline borders at 9% and 16% ink, never solid grey rules.

## Colors

A neutral ink-on-white (or ink-on-black) field with a single accent and a small, fixed set of state and content-kind hues.

### Primary
- **Signal Violet** (accent, light): the primary action fill (New, Install Workspace CLI), the current tab underline, the selected range toggle, the active issue view, the focus ring, text caret and selection tint. Its deeper step (accent-hover / accent-text) carries hover fills and accent text on soft violet.
- **Console Lime** (accent-dark): occupies exactly the same slots in dark. Text on a lime fill is the near-black on-accent-dark, never white.
- **Flask Vermilion** (brand): the OfficeLab flask mark only, both themes, with on-brand for the mark's inner strokes.

### Secondary
- **Merged Teal** (merged, merged-dark): merged Pull requests, the merged pill in the activity chart, the Base content kind. Merged-text on merged-soft for chips.

### Tertiary
- **State hues**: open green (open) for open Pull requests and Issues; amber (warn, warn-text on warn-soft) for Ready and Merging chips and the Star; red (danger, danger-text on danger-soft) for discarded, closed, deletions and the Danger zone.
- **Content kinds**: sheet green, doc sky, slide orange, folder grey; Board reuses the accent and Base reuses merged teal.
- **Reserved attribution pair**: people blue (actor-people) and agents pink (actor-agents), with soft and text steps and dark counterparts in `theme.css`. These are **reserved for a later people-versus-agents attribution feature and are currently unused**. Avatars and pending chips today use the neutral actor-unknown set, which equals ink-2 on panel-2.

### Neutral
- **Paper White / Console Black** (ground, ground-dark): page ground. Panels sit on the same value in light and one step up in dark.
- **Panel Grey** (panel-2): hover fill, inactive counts, segment and toggle pressed state, icon tiles.
- **Sunken** (sunken): list headers (the file table's latest-event row, the issue list head).
- **Hairline / Hairline Strong** (line, line-2): line divides rows, frames cards and the top bar; line-2 frames inputs, toggles, tooltips and separates inline metadata.
- **Ink / Ink 2 / Ink 3**: primary text; secondary text and icons; tertiary text, placeholders, axis labels and timestamps.

### Named Rules
**The One Accent Slot Rule.** Violet belongs to light and lime belongs to dark; they fill the same roles (primary action, current tab or view, pressed toggle, focus ring, selection) and never appear together. The chart's Pull request series and the Board kind follow the accent, so they flip with the theme.

**The Kind Is a Tint Rule.** Content-kind colour appears only on the 26px icon tile: the hue as icon colour, 14% as fill, 26% as an inset ring. Rows, names and text never take the kind hue.

**The Reserved Pair Rule.** People blue and agents pink are spent on nothing until attribution ships: not on charts, labels, avatars or decoration.

**The Mark Owns Vermilion Rule.** Flask Vermilion appears in the OfficeLab mark and nowhere else.

## Typography

**Display Font:** Plus Jakarta Sans Variable at 700 to 800 (with PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, system-ui)
**Body Font:** Plus Jakarta Sans Variable
**Label/Mono Font:** Geist Mono Variable (with ui-monospace, SF Mono, CJK fallbacks)

**Character:** One geometric humanist sans does all the talking, tightened at heading sizes; a mono with tabular figures does all the counting, like the readouts on a console.

### Hierarchy
- **Display** (800, 38px, 1.12, -0.032em): the Home headline only ("3 open Pull requests across 3 repositories"), max 24ch, balanced wrap; the leading count takes accent-text. Chinese: 32px, -0.01em, keep-all. Under 720px: 28px (24px Chinese).
- **Headline** (700, 24px, -0.025em to -0.03em): page and repository titles, settings heading. The Pull request detail title steps up to 28px.
- **Title** (700, 18px): Home section heads (Pull requests, Continue working, Issues).
- **Title small** (600, 14.5 to 16px): card titles at 15.5px, issue and home-issue titles at 14.5px, rail and panel heads at 14px 700.
- **Body** (400, 14px, 1.5): the app default. Repository description 15px at 1.6, max 72ch.
- **Body small** (400, 13 to 13.5px): metadata runs, descriptions, file notes, secondary copy.
- **Label** (600, 12.5px): sentence-case group headings in side navs, in ink-3; 12px 500 to 600 for chips and labels.
- **Figure** (Geist Mono 500, 12px, tabular): counts beside tabs and views, chart axes, rank numbers, legend and fact numbers, the CLI command, the kbd hint.

### Named Rules
**The Mono Counts Rule.** Geist Mono is for numbers, identifiers and code only. Words, labels and headings are always Plus Jakarta Sans. Inside card metadata runs, numbers return to the sans with tabular figures so a sentence does not change face midway.

**The Tight Heading Rule.** Everything 18px and up is 700 or 800 with negative tracking (-0.025em to -0.032em); Chinese eases to -0.01em.

**The Published Pages Exception.** The Pages directory renders in a GitHub Pages (Primer) look: system UI stack at 16px with its own page palette (`--rd-page-*`, light and dark). It is scoped to `.repository-pages` and is the only place the system font stack is the face.

## Layout

The app is a fixed-height column: a 56px top bar, then a scrolling viewport. Global and repository frames centre at max 1312px with 32px side gutters (16px under 760px). Home is a three-column grid: 272px repository rail, fluid main column (36px 44px padding), 300px right rail for the CLI card; at 1240px the right rail drops under the main column and the left rail narrows to 248px; at 760px everything stacks with the rail after the main column. A repository's Code tab is a two-column grid (fluid main, 300px sticky About aside, 36px gap) that stacks at 1080px. Issues and Settings use a 216px sticky side nav beside the content (36px gap).

The top bar carries brand, breadcrumbs, a 340px search with a Cmd-K hint, horizontal nav pushed right, and tools. Breadcrumbs hide at 1240px; at 1080px the nav wraps to a second, horizontally scrolling row with a fade mask. Horizontal scrollers (tabs, side navs on mobile) fade out their last 44 to 48px instead of showing scrollbars.

Rhythm runs on 4px with common steps of 8, 12, 16, 20, 24, 32 and 36px. Sections on Home sit 36px apart; card lists stack with a 10px gap.

## Elevation & Depth

Flat by default. Every in-flow surface (cards, list frames, the chart card, rails) sits on hairlines and fill steps, with `--shadow-xs` and `--shadow-sm` set to none. Depth comes from ground, panel-2 and sunken values plus line and line-2 borders. One shadow exists for things that float above the page: the chart tooltip, popovers, menus and dialogs. The top bar is translucent (92% ground) with a 10px backdrop blur so content passes under it.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 12px 32px rgba(15,18,30,.12), 0 2px 6px rgba(15,18,30,.06)`; dark `0 12px 32px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.4)`): tooltips, popovers, menus, dialogs.
- **Inset ring** (`box-shadow: inset 0 0 0 1px <line or hue mix>`): an outline that does not change layout, used on icon tiles, avatars, visibility badges, labels and pressed segments.

### Named Rules
**The Flat-at-Rest Rule.** Hover changes fill (to panel-2) and border (to line-2), never lift. The only motion on press is a 1px downward nudge on item cards.

## Shapes

Soft-cornered rectangles scaled to their size: 4 to 5px on badges, counts and kbd keys; 6 to 8px on segment buttons, toggles, nav links and selects; 9px on buttons, inputs, list rows and the CLI code block; 12px on item cards, panels, settings sections and the Danger zone; 14px on framed lists and tables (file table, issue list, home issues, chart card). Issue labels are full pills. The active tab underline is a 2px bar with rounded ends, inset 8px from the tab edges.

**Tiles for Things, Circles for People.** Repositories and content kinds sit on rounded-square tiles (24 to 34px, 7 to 10px radius); people are circular initial avatars (20, 24 or 32px). The two shapes never swap.

## Components

### Buttons
Compact and solid, never shadowed.
- **Shape:** gently rounded (9px), 34 to 36px tall in toolbars, 28px in the rail.
- **Primary:** accent fill with on-accent text, 600 weight, 13 to 13.5px (New, Install Workspace CLI, New issue); accent-hover on hover. In dark it becomes lime with near-black text.
- **Secondary:** panel fill, ink text, hairline border, 12 to 13.5px 500 to 600; panel-2 on hover (Download Workspace Agent, New in the rail, toolbar selects).
- **Icon button:** 34px square (28px in dense spots), transparent until hover, then panel-2 fill and a hairline border; 16px icons.

### Chips
- **Counts:** mono 12px on panel-2 in ink-2, 5px radius; on the current tab they turn accent-text on accent-soft.
- **State chips:** Pull request state uses the state hues on their soft fills (Ready and Merging amber, merged teal, discarded red, open green, draft neutral) with an inset hairline ring.
- **Issue labels:** 22px pills; text is the label hue mixed 62% toward ink (black in light, white in dark), fill 15%, inset ring 32%, with a 7px dot.
- **Pending change chip:** 11.5px on actor-unknown soft with a 35% ring, 4px radius, links to the open Pull request touching that file.
- **Visibility badge:** 12px on panel-2 with an inset hairline, 5px radius.

### Cards / Containers
- **Corner Style:** 12px for item cards, 14px for framed lists.
- **Background:** panel; hover panel-2 with line-2 border.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px line.
- **Internal Padding:** item cards 15px 20px 14px (13px 14px on mobile); list rows 13px 16px; file rows 9px 16px at 50px min height.

### Inputs / Fields
- **Style:** panel fill, 1px line-2 border, 9px radius, 34 to 36px tall, 13 to 13.5px text, ink-3 placeholder and leading icon.
- **Focus:** border turns accent; the top-bar search also steps its fill to panel-2. Keyboard focus anywhere draws a 2px accent outline at 2px offset.

### Navigation
- **Top nav:** 500-weight ink-2 links with 7px 11px padding and 8px radius; hover panel-2 and ink; current page ink 600 with no fill.
- **Repository tabs:** icon plus label plus count, ink-2 at 500; hover panel-2 with rounded top corners; current tab accent-text 600 with a 2px accent underline.
- **Directory tabs:** flatter underline tabs with a 24px gap and 2px accent bottom border on the current one.
- **Side views (Issues, Settings):** full-width rows, 9px radius; current view accent-text on accent-soft, its mono count in accent-text. Group headings are sentence case, 12.5px 600, ink-3.
- **Segments and toggles:** inline button groups; pressed segment is panel-2 with an inset hairline (neutral), pressed range toggle is accent-text on accent-soft.
- **Mobile:** navs become single horizontal scrollers with a trailing fade mask.

### Activity Chart (signature)
The repository's stacked daily bar chart over 7 or 14 days: Pull requests opened in the accent, Issues opened in ink-3 grey, merged Pull requests as teal count pills riding above the day. Hairline gridlines with dashed day lanes, mono axis figures, a legend with mono totals and a note. Hovering or picking a day dims other columns to 28% opacity and shows a floating tooltip; a picked day filters the file table and shows an accent-soft day filter chip. Home repeats the series as a ranked list: rank number, name, a 12px stacked track (accent for Pull requests, grey for Issues), and figures.

### Inline Metadata Run
Facts in a row (repository metas, card meta, issue meta, row meta) are separated by a 1px line-2 vertical rule in a 20px column gap, never by dots or bullets.

## Do's and Don'ts

### Do:
- **Do** scope every Repository-mode rule under `:root[data-ui-mode="repository"]` and its nested `.dark`; Wiki mode is a separate world.
- **Do** route the primary action, current tab or view, focus ring and selection through the accent slot so it reads violet in light and lime in dark.
- **Do** set counts, axes, ranks, identifiers and commands in Geist Mono with tabular figures.
- **Do** show content kind on a tinted 26px tile (14% fill, 26% inset ring) and people as circular initials.
- **Do** separate inline metadata with 1px line-2 vertical rules.
- **Do** keep in-flow surfaces flat: hover is a fill step to panel-2 and a border step to line-2.

### Don't:
- **Don't** use the people blue or agents pink series colours until the attribution feature ships; they are reserved and currently unused.
- **Don't** show violet in dark or lime in light, or put white text on lime.
- **Don't** add drop shadows to cards, list frames or the chart card; the float shadow is for tooltips, popovers, menus and dialogs only.
- **Don't** set prose, labels or headings in the mono.
- **Don't** use Flask Vermilion outside the OfficeLab mark.
- **Don't** put small uppercase eyebrow labels above headings; group labels are sentence case, 12.5px, ink-3.
- **Don't** colour row text or file names with content-kind hues.
