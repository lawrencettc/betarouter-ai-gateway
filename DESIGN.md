# DESIGN.md — Public Beta

Styling guide for building publicbeta.io and Public Beta-branded surfaces. Public Beta is a venture studio building the operating layer for the post-AI era, proven on lean, default-alive companies it runs itself. Audience: investors and partners first, founders second. Everything below is copy-paste ready for CSS/Tailwind config.

## 1. The brand in one line
High-impact editorial meets terminal precision: near-black paper, cream ink, Bricolage Grotesque conviction headlines, JetBrains Mono system-labels, one ochre strike color. Institutional with an engineering soul.

## 2. Color
```css
:root {
  /* constants */
  --paper: #131313;          /* page background — dark-only, no light mode */
  --forest: #004d2c;         /* full-bleed brand field — every page gets at least one; also allowed on claim blocks / stat bands */
  --surface-lowest: #0d0f0d; /* inputs, code blocks */
  --surface-card: #181c19;   /* green-tinted darks throughout */
  --surface-deep: #1a201b;   /* alternate section bg */
  --surface-raised: #242a25;
  --ink: #e5e2e1;            /* headlines, emphasized text */
  --ink-2: #bfc9bf;          /* body copy — ALWAYS this, not full ink */
  --muted: #8a938a;          /* mono labels, metadata */
  --rule: #404942;           /* 1px borders — the only divider */
  /* Public Beta accents */
  --ochre: #ed9000;          /* strike accent: headline stamps, underlines, arrow-links, live dots, focus borders */
  --ochre-ink: #2c1700;      /* text on ochre */
  --action: #004d2c;         /* THE action color: primary buttons/CTAs — white text + 1px rgba(229,226,225,0.18) border */
  --green: #08A84E;          /* informational green: healthy/positive dots, data highlights — paper backgrounds only */
  --focus: #ffdcbc;          /* focus rings */
  --error: #ffb4ab; --error-ink: #690005;
}
```
Rules: forest green is the action color — one primary CTA per view (forest bg, white text). Ochre is the strike accent: stamps, underlines, links, live dots — never button fills. **Every page gets at least one full-bleed forest section**; forest may also back claim blocks, pull-quotes, and stat bands. **On forest backgrounds all text is white `#ffffff`** (secondary at `rgba(255,255,255,0.75)`) — never green. `--green` marks informational/positive states on paper only. All neutral surfaces are green-tinted. NO shadows, NO gradients, NO transparency/blur — depth is tonal steps + 1px rules.

**Product family:** each Public Beta venture takes one hue slot (accent + deep field + tint) while every constant above stays fixed — e.g. betarouter = sky blue #8ec8f6 / #0b3a5e, Beta Studio = lilac #dcb5f7 / plum #46165e. Never mix two accents in one view.

## 3. Typography
```css
/* Google Fonts: Bricolage+Grotesque:opsz,wght@12..96,300..800; Inter:400..600; JetBrains+Mono:400..500 */
--font-display: 'Bricolage Grotesque', sans-serif; /* headlines, buttons, claims */
--font-body: 'Inter', system-ui, sans-serif;        /* body, forms */
--font-mono: 'JetBrains Mono', monospace;           /* labels, metadata, code */
```
- Display: 800 weight, `clamp(2.5rem, 7.4vw, 5.4rem)`, line-height 1.02, letter-spacing −0.025em. One `<h1>` per page, max ~15ch.
- Section headings: 700, `clamp(1.7rem, 3.6vw, 2.7rem)`, lh 1.08, ls −0.015em. Sentence case, often ending with a period ("Why now.").
- Claims (editorial argument blocks): display 500 at `clamp(1.25rem, 2.4vw, 1.7rem)`, lh 1.35, bold white lead-in sentence, body at `rgba(229,226,225,0.8)`, max 46ch. Stagger successive claims with increasing left indent (+8vw per step).
- Body: Inter 400, 16px/1.65, color `--ink-2`, max-width 58ch.
- Mono labels: 12px, +0.08em tracking, UPPERCASE, color `--muted`. Used for nav, status chips, footnote lists ("routing · cost control · evals").
- Signature motif: ONE word per headline in a solid ochre stamp — `background: var(--ochre); color: var(--ochre-ink); padding: 0 0.18em;` — "What took ten people now takes **one**."

## 4. Logo & wordmark
The wordmark IS the logo: "public**beta**" — Bricolage Grotesque 800, ls −0.02em, "beta" in the ochre stamp (padding 0 0.16em, margin-left 0.18em). No pictorial mark. Favicon: ochre square with lowercase "b". Profile avatar: white "public" + stamped "beta" centered on forest.

## 5. Spacing & layout
- Scale: 8 / 16 / 24 / 40 / 64 / 104 / 168px. Section padding 104–168px vertical.
- Container: max-width 1140px; gutters `clamp(20px, 5vw, 72px)`.
- Grid motifs: asymmetric 5/7 two-column rows (title + mono role left, copy right); staggered indented claim blocks; whitespace instead of boxes — portfolio "cards" have NO borders or fills.

## 6. Shape, depth, motion
- Radii: containers 0 (sharp); buttons/inputs 4px; chips/pills 999px. Nothing else.
- Borders: 1px `--rule`; focus/hover swaps to `--ochre`.
- Motion: `cubic-bezier(0.16, 1, 0.3, 1)` at 160ms (hover) / 320ms (entrances). Entrances: translateY(18px)→0 + fade, staggered 120ms. Respect `prefers-reduced-motion`.
- Hover: primary buttons → opacity 0.92; links `--muted`→`--ink`; arrow-links gain ochre underline. No lifts, no scale.

## 7. Components (copy these patterns exactly)
- **Button primary**: forest `--action` bg, white text, 1px `rgba(229,226,225,0.18)` border, Bricolage 700, 13px×20px padding (20px×24px large), 4px radius.
- **Button outline**: transparent, 1px `--rule` border → ochre border on hover.
- **Input/Textarea/Select**: `--surface-lowest` bg, 1px `--rule`, 4px radius, 13px×16px padding, Inter 14px; mono uppercase micro-label above; ochre border on focus.
- **Choice pills** (radio): mono 12px, 999px pill, 8px×18px; selected = ochre border + ochre text + 5% ochre tint bg.
- **Status chip**: 7px ochre dot + mono uppercase label ("● LIVE · FLAGSHIP"; idle dot = `--rule`).
- **Ticker**: mono metadata strip, middle-dot separated, live dot on first item ("● 2 companies live · 1 venture slot open").
- **Table**: mono uppercase headers, 1px `--rule` row dividers, no zebra/fills; optional mono "1.0 / 2.0" index column.
- **Venture card**: status chip + display-weight name + copy + ochre mono arrow-link ("betarouter.com →"). No box.

## 8. Iconography & imagery
NO icon set, NO emoji. Glyphs: → and · only. Diagrams: hand-built SVG line drawings — 1px `rgba(229,226,225,0.2)` boxes, mono 13px labels, dashed ochre ring with a slow `stroke-dashoffset` march animation. No photography; if imagery is unavoidable, keep it dark, desaturated, cool.

## 9. Voice (for any copy you write)
Declarative, compressed, numerate. Short verdict sentences ("Anything else dies." "Proof beats pitch."). Sentence case everywhere; headings may end with periods. "we" for the studio, "you" only in CTAs ("Bring us the wedge →"). Numbers over adjectives — every claim carries a receipt ("revenue per human, cost per task, time-to-revenue"). Venture names lowercase when styled ("betarouter"). Mono footnotes list capabilities with middle dots.

## 10. Don'ts
No light mode. No shadows/gradients/glassmorphism. No rounded cards with colored left borders. No icon fonts. No title-case headlines. No emoji. Don't mix ochre with a venture's accent in one view. Don't snap the 4px control radius to 8px or the 1140px container to 1200px.
