---
name: OfficeLab Repository global screens
description: High-fidelity GitHub Dashboard styling for Repository navigation and global lists.
colors:
  background: "#ffffff"
  surface: "#f6f8fa"
  foreground: "#1f2328"
  muted-foreground: "#59636e"
  border: "#d1d9e0"
  secondary-hover: "#eff2f5"
  accent: "#818b981a"
  primary: "#0969da"
  primary-hover: "#0550ae"
  action: "#1f883d"
  action-hover: "#1a7f37"
  on-action: "white"
  state-open: "#1a7f37"
  state-merged: "#8250df"
  state-closed: "#d1242f"
  dark-background: "#0d1117"
  dark-surface: "#010409"
  dark-content-surface: "#151b23"
  dark-foreground: "#f0f6fc"
  dark-muted-foreground: "#9198a1"
  dark-border: "#3d444d"
  dark-secondary: "#212830"
  dark-secondary-hover: "#262c36"
  dark-accent: "#656c7633"
  dark-primary: "#4493f8"
  dark-primary-hover: "#79b8ff"
  dark-action: "#238636"
  dark-action-hover: "#29903b"
  dark-state-open: "#3fb950"
  dark-state-merged: "#ab7df8"
  dark-state-closed: "#f85149"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif'
    fontSize: "14px"
  headline:
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  section:
    fontSize: "16px"
    fontWeight: 600
  repository-title:
    fontSize: "20px"
    fontWeight: 600
  search:
    fontSize: "13px"
  metadata:
    fontSize: "12px"
  label:
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "20px"
rounded:
  control: "6px"
  label: "20px"
spacing:
  compact: "8px"
  row-gap: "12px"
  row: "16px"
  card: "20px"
  section: "24px"
  dashboard-section: "28px"
  page: "32px"
components:
  button-create:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.control}"
  button-create-hover:
    backgroundColor: "{colors.action-hover}"
  search:
    backgroundColor: "{colors.background}"
    typography: "{typography.search}"
    rounded: "{rounded.control}"
  navigation-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  label:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.label}"
    padding: "0 7px"
---

# Design System: OfficeLab Repository global screens

## Overview

**Creative North Star: "A「GitHub 工作总览」"**

The user selected GitHub Dashboard and requested high GitHub fidelity. OfficeLab
uses its compact navigation, system typography, neutral borders, blue links, and
green creation actions across the dashboard and global directories.

Scope: dashboard, repositories, global Pull Requests and Issues, Recent, and Pages.
Wiki and editor iframe appearance have separate owners. The existing shared UI
primitives supply controls and overlays; Repository styles specialize their chrome.

**Key Characteristics:**
- Dense, readable navigation and metadata-led lists.
- Flat bordered surfaces in light and dark themes.
- Real resource metadata and explicit query states.

## Colors

Primary blue identifies links, focus, and selected navigation; action green identifies
creation. Open, merged, and closed state colors communicate actual review state.
Neutral background, surface, border, and muted text tokens separate content without
decorative color blocks.

Unprefixed tokens describe light mode; `dark-` tokens describe the corresponding
dark override. Light secondary controls use `surface`; dark secondary controls use
`dark-secondary`. The focus ring uses the current primary color. These values come
from [styles.css](web/src/modes/repository/styles.css) and
[dashboard.css](web/src/modes/repository/dashboard.css), scoped to global chrome.
The separately scoped published Pages/Primer presentation is not a replacement for
the global Pages directory palette.

## Typography

Use the body system stack throughout. Page headings use `headline`; section and row
titles use `section`; repository directory names use `repository-title`. Supporting
metadata uses `metadata`, with no smaller informational text. Compact search and
auxiliary text use the observed 13px size. At the mobile breakpoint, page headings
become 22px, repository names 18px, and row titles 14px.

## Layout

A 64px full-width toolbar with a bottom border sits above a 256px navigation sidebar and scrolling content.
The dashboard has a flexible main column and a 260px auxiliary column, with a 32px
gap and a 1400px maximum width. Full directories use a 1200px maximum width. Both
use 32px desktop padding. Resume cards form two columns; rows and panels carry the
work rather than a grid of statistics.

At widths up to 1150px, the sidebar narrows to 232px, dashboard padding becomes 24px,
and the auxiliary content moves below the main column into two columns. At widths
up to 720px, navigation moves into the existing drawer, header search hides, page
padding becomes 20px 16px, and resume and auxiliary content stack. Toolbar search
occupies a full row. Mobile global buttons have a minimum 44px width and height;
navigation and secondary links have a minimum 44px height.

## Elevation & Depth

Use 1px neutral borders and surface changes for depth. Panels and cards are flat;
creation buttons retain the existing subtle `0 1px 0 rgb(31 35 40 / 4%)` shadow.
Preserve shared overlay behavior rather than adding a global shadow or motion system.

## Shapes

Controls, cards, and panels use `control` rounding. Compact metadata labels use
`label` rounding and a neutral outline. SVG icons mark navigation, resources, and
states; they do not substitute for labels. Most navigation icons are 16px.

## Components

- **Buttons:** green creation action, neutral secondary action, existing shared
  Button sizes and disabled behavior. Hover changes the background. Keyboard focus
  has a 2px primary outline offset by 3px.
- **Search:** existing shared Input with a leading search icon, 32px left padding,
  accessible label, and body-background fill. Sidebar and header search are 32px high;
  directory search retains the shared 36px control height. Header search
  is transparent with an inset return-arrow submit button and a 220–350px responsive width.
  Mobile search inputs are 44px high. Placeholder text uses muted foreground at full opacity.
- **Navigation:** icon and label, neutral hover fill, and an active state with
  `aria-current="page"`, semibold text, and a 3px blue leading indicator. Repository
  search and creation remain beside the repository list. Desktop navigation rows are
  32px high, with muted icons and a 32px account avatar. Outlined 32px Issues and Pull
  request shortcuts sit beside header search; both hide with search on mobile.
- **Panels and rows:** bordered panels, surface-colored headers, divided rows,
  and surface-colored row hover. Titles wrap; metadata can wrap across lines.
- **Pages:** global directory rows show real file metadata. Clicking opens the existing
  safe preview; rows do not render HTML previews or manufacture thumbnails.
  The dashboard omits the recently visited Pages section at the user's request.
- **Dashboard details:** resume titles use link blue; hovering underlines the title and
  changes the card surface. Resource icons are unboxed within the dashboard. Summary
  row titles use 14px, auxiliary document titles 13px. Guide cards share the
  page background, while dark content hover uses `dark-content-surface`; the global
  header retains `dark-surface`. Timestamp separators stay with their timestamps.
- **Query states:** existing Skeleton for loading, an alert and retry for initial
  failures, explanatory empty states, and explicit load-more controls for lists.

## Do's and Don'ts

### Do:
- Do retain the selected GitHub Dashboard direction and OfficeLab identity.
- Do apply the light or dark token set consistently within Repository global chrome.
- Do preserve accessible labels, visible keyboard focus, and mobile touch targets.
- Do display real metadata and distinguish loaded counts from totals.

### Don't:
- Don't restyle Wiki or Office/HTML iframe content through these tokens.
- Don't invent activity metrics, Page thumbnails, or preview content.
- Don't add raster artwork or replace existing shared UI primitives.
