// @expect-lint typescript(no-floating-promises)
async function save(): Promise<void> {}

export function handler(): void {
  save();
}
