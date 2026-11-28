import Foundation
import Testing

/// The String Catalogs compile into one table per language, and the Watch app is embedded in the iPhone app. The
/// Watch app's own bundle is checked here, inside the embedded copy, because a hosted test on the watchOS simulator
/// can't launch reliably in CI (see scripts/test.sh).
struct EnduvaTests {
    @Test(arguments: [
        ("en", "Endurance, strength and nutrition in one app"), ("de", "Ausdauer, Kraft und Ernährung in einer App"),
    ])
    func theTaglineIsTranslated(language: String, expected: String) throws {
        #expect(try localized("shell.tagline", in: .main, language: language) == expected)
    }

    @Test(arguments: [("en", "In development"), ("de", "In Entwicklung")])
    func theWatchStatusIsTranslated(language: String, expected: String) throws {
        #expect(try localized("shell.status", in: watchApp(), language: language) == expected)
    }

    @Test func theWatchAppIsEmbeddedAndRunsWithoutTheiPhone() throws {
        let watch = try watchApp()
        let app = try #require(Bundle.main.bundleIdentifier)
        #expect(watch.bundleIdentifier == "\(app).watchkitapp")
        #expect(watch.object(forInfoDictionaryKey: "WKCompanionAppBundleIdentifier") as? String == app)
        #expect(watch.object(forInfoDictionaryKey: "WKRunsIndependentlyOfCompanionApp") as? Bool == true)
    }

    private func watchApp() throws -> Bundle {
        try #require(Bundle(url: Bundle.main.bundleURL.appending(path: "Watch/EnduvaWatch.app")))
    }

    private func localized(_ key: String, in bundle: Bundle, language: String) throws -> String {
        let path = try #require(bundle.path(forResource: language, ofType: "lproj"))
        return try #require(Bundle(path: path)).localizedString(forKey: key, value: nil, table: nil)
    }
}
