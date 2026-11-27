# Daybreak

![Daybreak in Default, Dark and Mono](appearances.png)

## Apple app icon

1. In Icon Composer, create an iOS document. Use the solid fill from `ios/light/background.svg` for the canvas. Import `sun.svg` and `bowl.svg` from the same folder as separate foreground layers at their original position and scale. Both use the full 1024 × 1024 canvas, with the sun centered at x = 512.
2. Set per-appearance fill overrides using the table below. The matching SVGs in each folder provide editable color references with transparent foregrounds. Preview Mono with several light and dark user tints. For a legacy Dark asset-catalog export, export the foreground on transparency.
3. For the Watch platform use the single light appearance. The `watchos/` layers share a 1088 × 1088 canvas with 32 px added on each edge of the iOS grid. Apply the peach fill edge to edge and inspect the circular mask in Composer.
4. Save as `Enduva.icon`. App-target integration and checking material effects on device belong to task 0.11a. [Apple Icon Composer guide](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer)

| Appearance | Canvas | Sun | Bowl |
| --- | --- | --- | --- |
| Default | #FFD7AD | #A93420 | #38241D |
| Dark | #291D1A | #EFA174 | #FFF2E3 |
| Mono (tinted) | #202020 | #A8A8A8 | #EEEEEE |

## Legibility

At 16, 29, 60, 180 and 1024 px, raster checks on each appearance and the Watch artwork distinguish three solid colors along the centerline: sun, open space, then bowl. At 16 px the sun spans about five pixels and the central opening about three. When adjusting material effects, check these smallest sizes again at actual scale.

## Web and UI

Run `pnpm install --frozen-lockfile` and `node tools/render-brand.mjs` from the repository root. The pinned resvg WebAssembly renderer produces the PNGs and preview. The ICO embeds the 16 and 32 px PNGs. The OG artwork uses the original outlined wordmark for both German and English.

Build with `pnpm --filter @enduva/ui build`. Import `{ tokens }` from `@enduva/ui/tokens` or load `@enduva/ui/tokens.css`. CSS variables such as `--enduva-color-text` follow the system appearance. Set `data-theme="light"` or `data-theme="dark"` for an explicit theme. Use the on-primary and on-accent colors for labels on those fills. The product typeface is [Manrope, SIL Open Font License](https://github.com/google/fonts/tree/main/ofl/manrope).
