# FMD Themes

A **theme** is a ready-made look for your app: a font, a content width, and a
six-color palette. In FMD you apply one by dropping a `[Style]` block at the
**top** of your `.fmd` document. That's it — the block styles the whole app.

You can also just tell the AI assistant **"use the Midnight Pro theme"** (or any
name below) and it will paste the matching `[Style]` block in for you.

## How a theme works

Six color keys are all you need for a complete look:

| Key | What it colors |
| --- | --- |
| `[Background]` | the page behind everything (`--bg`) |
| `[Foreground]` | panels + cards (`--panel`, `--panel-2`) |
| `[Text]` | body text — auto-derives muted text + heading colors |
| `[Lines]` | borders + dividers (`--line`) |
| `[Primary]` | primary buttons / accent — auto-derives readable button text |
| `[Secondary]` | secondary accent |

Colors can be hex (`#6ea8fe`) **or** common names (`white`, `navy`, `teal`,
`slate`, `indigo`, …). `[Colors]` may also be written `[Palette]` or `[Theme]`.

`[Size]` sets the content max-width — `Compact | Standard | Full`.
`[Font]` picks from: `system, serif, mono, Inter, Roboto, Poppins, Lato,
Montserrat, Nunito, Open Sans, Work Sans, Merriweather, Playfair Display,
Source Code Pro`.

---

## 1. Midnight Pro

**When to use it:** dashboards, admin panels, or any serious "product" app that
should feel calm at night.
**Mood:** sleek, focused, professional dark UI.

```
[Style]
  [Size] Standard
  [Font] Inter
  [Colors]
    [Background] #0e1116
    [Foreground] #171b22
    [Text] #e6e9ee
    [Lines] #2a2f3a
    [Primary] #6ea8fe
    [Secondary] #34d399
```

---

## 2. Daylight Minimal

**When to use it:** docs, forms, and content-first apps that need to feel light,
clean, and effortless to read.
**Mood:** crisp, airy, modern minimalism.

```
[Style]
  [Size] Standard
  [Font] Work Sans
  [Colors]
    [Background] #ffffff
    [Foreground] #f6f7f9
    [Text] #1f2430
    [Lines] #e3e6ea
    [Primary] #2563eb
    [Secondary] #0ea5e9
```

---

## 3. Terracotta Warmth

**When to use it:** cozy, human, lifestyle or community apps that want to feel
warm and inviting rather than corporate.
**Mood:** earthy, warm, grounded.

```
[Style]
  [Size] Standard
  [Font] Nunito
  [Colors]
    [Background] #fbf3e9
    [Foreground] #f3e4d3
    [Text] #3b2a20
    [Lines] #e0cbb3
    [Primary] #c05621
    [Secondary] #6b8e5a
```

---

## 4. Neon Voltage

**When to use it:** landing pages, launch demos, or anything that should grab
attention with punchy, high-contrast color.
**Mood:** bold, vivid, high-energy.

```
[Style]
  [Size] Full
  [Font] Montserrat
  [Colors]
    [Background] #0a0a0f
    [Foreground] #16161f
    [Text] #f5f5fa
    [Lines] #33333f
    [Primary] #ff2e88
    [Secondary] #00e5ff
```

---

## 5. Ivory Editorial

**When to use it:** long-form reading, portfolios, or elegant "magazine" style
apps where typography is the star.
**Mood:** refined, calm, timeless serif elegance.

```
[Style]
  [Size] Compact
  [Font] Playfair Display
  [Colors]
    [Background] #faf7f2
    [Foreground] #ffffff
    [Text] #2d2a26
    [Lines] #e6ddd0
    [Primary] #7c6a58
    [Secondary] #9c6f4a
```

---

### Tweaking a theme

Start from any block above and change one thing at a time. Swap a single color
(e.g. change `[Primary]` to your brand color) and the button text recolors
itself automatically. Change `[Font]` to shift the whole personality, or bump
`[Size]` between `Compact → Standard → Full` to control how wide the
content runs — no other edits needed.
