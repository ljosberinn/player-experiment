import { type GlyphProps, ICONS, type IconName } from "./registry";

/**
 * An icon, named by what it means rather than by what it looks like.
 *
 * The single point every icon in the app goes through. `registry.tsx` maps the
 * names to one library's components and is the only file that mentions which
 * library that is; nothing here or at a call site does.
 *
 * Always decorative. Every icon in this app sits beside its own label or inside
 * a button that carries an `aria-label`, so an accessible name here would be
 * announced twice. A future icon that is genuinely the only label wants a
 * `label` prop and a `<title>`, not an exception made at its call site.
 */
export function Icon({
  name,
  size,
  className,
}: {
  name: IconName;
  /** Pixels. Stated rather than inherited: an icon that sizes itself off the
      font follows the density steps, and these are drawn to the chrome. */
  size: number;
  className?: string;
}) {
  const Glyph = ICONS[name];
  // Built rather than spread: under `exactOptionalPropertyTypes` an explicit
  // `className={undefined}` is not the same as no `className` at all, and the
  // icon libraries declare theirs the second way.
  const props: GlyphProps =
    className === undefined
      ? { size, "aria-hidden": "true" }
      : { size, className, "aria-hidden": "true" };

  return <Glyph {...props} />;
}
