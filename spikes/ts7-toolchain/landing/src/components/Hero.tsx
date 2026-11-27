export interface HeroProps {
  title: string;
  switchLabel: string;
  switchHref: string;
}

export function Hero({ title, switchLabel, switchHref }: HeroProps) {
  return (
    <header>
      <h1>{title}</h1>
      <a href={switchHref}>{switchLabel}</a>
    </header>
  );
}
