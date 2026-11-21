import fireside from "./assets/looks/fireside.webp";

/**
 * A holiday picture behind a page of the app's own (the home screen, the Guide): fixed while the page scrolls,
 * softened and washed with the page color so the solid cards over it stay easy to read. A Game's pages use its
 * Theme instead.
 */
export function Backdrop({ image = fireside }: { image?: string }) {
  return <div className="page-backdrop" style={{ backgroundImage: `url(${image})` }} aria-hidden="true" />;
}
