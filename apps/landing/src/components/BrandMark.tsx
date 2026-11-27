/**
 * The Daybreak mark (sun over bowl, `assets/brand/final`). Decorative: the link around it carries
 * the label. Colors follow the theme tokens, so it also works in dark mode.
 */
export function BrandMark({ size = 32 }: Readonly<{ size?: number }>) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="160 190 704 640"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="brand-mark-sun" cx="512" cy="351" r="150" />
      <path
        className="brand-mark-bowl"
        d="M177 521H310C340 634 416 682 512 682S684 634 714 521H847C818 707 686 817 512 817S206 707 177 521Z"
      />
    </svg>
  );
}
