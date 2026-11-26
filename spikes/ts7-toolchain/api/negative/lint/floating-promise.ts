// @expect-lint typescript(no-floating-promises) at 5:3
async function save(): Promise<void> {}

export function handler(): void {
  save();
}
