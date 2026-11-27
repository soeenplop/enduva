import Foundation
import Testing

/// The Watch app's String Catalog compiles into one table per language.
struct EnduvaWatchTests {
    @Test(arguments: [("en", "In development"), ("de", "In Entwicklung")])
    func theStatusIsTranslated(language: String, expected: String) throws {
        let path = try #require(Bundle.main.path(forResource: language, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        #expect(bundle.localizedString(forKey: "shell.status", value: nil, table: nil) == expected)
    }

    @Test func theAppRunsWithoutTheiPhone() {
        #expect(Bundle.main.object(forInfoDictionaryKey: "WKRunsIndependentlyOfCompanionApp") as? Bool == true)
    }
}
