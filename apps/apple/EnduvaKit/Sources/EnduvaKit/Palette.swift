import SwiftUI

/// The semantic colors of the design tokens (`packages/ui/src/tokens.ts`), light and dark. `Colors.xcassets` is
/// generated from the tokens by `packages/ui/generate-apple-colors.mjs`, so edit the tokens, not the catalog.
public enum Palette {
    public static let background = color("background")
    public static let surface = color("surface")
    public static let text = color("text")
    public static let muted = color("muted")
    public static let primary = color("primary")
    public static let onPrimary = color("onPrimary")
    public static let accent = color("accent")
    public static let onAccent = color("onAccent")
    public static let border = color("border")
    public static let success = color("success")
    public static let warning = color("warning")
    public static let danger = color("danger")

    /// Every color asset name above, for the test that checks they all exist in the catalog.
    static let names = [
        "background", "surface", "text", "muted", "primary", "onPrimary", "accent", "onAccent", "border", "success",
        "warning", "danger",
    ]

    private static func color(_ name: String) -> Color {
        Color(name, bundle: .module)
    }
}
