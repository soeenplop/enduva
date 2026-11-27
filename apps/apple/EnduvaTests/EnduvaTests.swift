import Foundation
import Testing

/// The String Catalog compiles into one table per language, and the Watch app is embedded in the iPhone app.
struct EnduvaTests {
    @Test(arguments: [
        ("en", "Endurance, strength and nutrition in one app"), ("de", "Ausdauer, Kraft und Ernährung in einer App"),
    ])
    func theTaglineIsTranslated(language: String, expected: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        #expect(bundle.localizedString(forKey: "shell.tagline", value: nil, table: nil) == expected)
    }

    @Test func theWatchAppIsEmbedded() throws {
        let watch = Bundle.main.bundleURL.appending(path: "Watch/EnduvaWatch.app")
        let bundle = try #require(Bundle(url: watch))
        let app = try #require(Bundle.main.bundleIdentifier)
        #expect(bundle.bundleIdentifier == "\(app).watchkitapp")
        #expect(bundle.object(forInfoDictionaryKey: "WKCompanionAppBundleIdentifier") as? String == app)
    }
}
