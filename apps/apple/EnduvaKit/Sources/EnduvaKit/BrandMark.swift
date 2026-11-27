import SwiftUI

/// The Daybreak mark (`assets/brand/final`): the sun over the bowl, drawn on the icon's 1024-point grid and scaled
/// to fit. Use it on the app's own screens; the home screen icon comes from `AppIcon.icon`.
public struct BrandMark: View {
    public init() {}

    public var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / 1024
            let transform = CGAffineTransform(scaleX: scale, y: scale)
                .translatedBy(x: (size.width / scale - 1024) / 2, y: (size.height / scale - 1024) / 2)
            context.fill(Self.sun.applying(transform), with: .color(Palette.accent))
            context.fill(Self.bowl.applying(transform), with: .color(Palette.text))
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }

    nonisolated static let sun = Path(ellipseIn: CGRect(x: 362, y: 201, width: 300, height: 300))

    /// `M177 521H310C340 634 416 682 512 682S684 634 714 521H847C818 707 686 817 512 817S206 707 177 521Z`
    nonisolated static let bowl = Path { path in
        path.move(to: CGPoint(x: 177, y: 521))
        path.addLine(to: CGPoint(x: 310, y: 521))
        path.addCurve(to: CGPoint(x: 512, y: 682), control1: CGPoint(x: 340, y: 634), control2: CGPoint(x: 416, y: 682))
        path.addCurve(to: CGPoint(x: 714, y: 521), control1: CGPoint(x: 608, y: 682), control2: CGPoint(x: 684, y: 634))
        path.addLine(to: CGPoint(x: 847, y: 521))
        path.addCurve(to: CGPoint(x: 512, y: 817), control1: CGPoint(x: 818, y: 707), control2: CGPoint(x: 686, y: 817))
        path.addCurve(to: CGPoint(x: 177, y: 521), control1: CGPoint(x: 338, y: 817), control2: CGPoint(x: 206, y: 707))
        path.closeSubpath()
    }
}
