/** Joins the truthy class names, e.g. `cx('btn', isActive && 'btn-active')`. */
export function cx(...classNames: (string | false | null | undefined)[]): string {
  return classNames.filter(Boolean).join(' ');
}
