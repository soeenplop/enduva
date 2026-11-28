import SwiftUI
import Testing

@testable import EnduvaKit

@Test func productionTalksToTheProductionAPIOverHTTPS() {
    #expect(APIEnvironment.production.baseURL.absoluteString == "https://api.enduva.soeenplop.dev")
}

@Test(arguments: Palette.names)
func everyPaletteColorExistsInLightAndDark(name: String) {
    let (light, dark) = (resolve(Color(name, bundle: .module), .light), resolve(Color(name, bundle: .module), .dark))
    // A name missing from the catalog resolves to clear.
    #expect(light.opacity == 1 && dark.opacity == 1)
    // `primary` and `onPrimary` stay the same in both appearances; every other token changes.
    #expect((light == dark) == ["primary", "onPrimary"].contains(name))
}

@Test func aMissingColorIsDetected() {
    #expect(resolve(Color("missing", bundle: .module), .light).opacity == 0)
}

private func resolve(_ color: Color, _ scheme: ColorScheme) -> Color.Resolved {
    var environment = EnvironmentValues()
    environment.colorScheme = scheme
    return color.resolve(in: environment)
}

@Test func theMarkStaysInsideTheIconGrid() {
    let grid = CGRect(x: 0, y: 0, width: 1024, height: 1024)
    #expect(grid.contains(BrandMark.sun.boundingRect))
    #expect(grid.contains(BrandMark.bowl.boundingRect))
    #expect(BrandMark.sun.boundingRect.maxY < BrandMark.bowl.boundingRect.minY)
}
