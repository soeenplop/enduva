import EnduvaKit
import SwiftUI

/// The app shell until sign-in (0.11b) replaces it: the mark, the name and what Enduva is.
struct RootView: View {
    var body: some View {
        VStack(spacing: 24) {
            BrandMark()
                .frame(width: 160)
            Text(verbatim: "Enduva")
                .font(.largeTitle.bold())
            Text("shell.tagline")
                .font(.title3)
                .multilineTextAlignment(.center)
            Text("shell.status")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.muted)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(Palette.text)
        .background(Palette.background)
    }
}

#Preview {
    RootView()
}
