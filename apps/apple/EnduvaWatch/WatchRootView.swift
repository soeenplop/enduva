import EnduvaKit
import SwiftUI

/// The Watch shell until the device session (2.8a): the mark and the name.
struct WatchRootView: View {
    var body: some View {
        VStack(spacing: 8) {
            BrandMark()
                .frame(width: 72)
            Text(verbatim: "Enduva")
                .font(.headline)
            Text("shell.status")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

#Preview {
    WatchRootView()
}
