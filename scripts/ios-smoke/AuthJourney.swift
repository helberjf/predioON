import Foundation
import XCTest

// This standalone runner controls only the two separately installed releases.
// XCTest activities/xcresult can contain typeText arguments: never export them.
final class AuthJourney: XCTestCase {
    enum Failure: Error { case configuration, transport, screen, privacy, secureInput, state }
    struct Account: Decodable {
        let name: String, email: String, buildingName: String, productTitle: String
    }
    struct Configuration: Decodable {
        let accounts: [String: Account]
        let oldPassword: String, newPassword: String, token: String
    }
    let products = ["resident-mobile", "operations-mobile"]
    let bundles = ["resident-mobile": "com.predioon.resident", "operations-mobile": "com.predioon.operations"]
    var configuration: Configuration!
    var rejected = false
    let passwordLabels = ["Senha", "Senha atual", "Nova senha", "Confirmar nova senha"]

    @discardableResult
    func host(_ path: String, payload: [String: Any]) throws -> [String: String] {
        guard !rejected || path == "rejection" else { throw Failure.privacy }
        var request = URLRequest(url: URL(string: "https://127.0.0.1:3555/" + path)!)
        request.httpMethod = "POST"
        request.setValue("Bearer " + configuration.token, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        request.timeoutInterval = 80
        let completed = expectation(description: "private local coordinator")
        var succeeded = false
        var result: [String: String] = [:]
        URLSession.shared.dataTask(with: request) { data, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode
            succeeded = error == nil && (status == 204 || status == 200)
            if status == 200, let data = data,
               let decoded = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
                result = decoded
            }
            completed.fulfill()
        }.resume()
        guard XCTWaiter.wait(for: [completed], timeout: 85) == .completed, succeeded else { throw Failure.transport }
        return result
    }

    func reject(_ kind: String) throws {
        rejected = true
        try? host("rejection", payload: ["kind": kind])
        throw Failure.privacy
    }

    // Inspect the first tree as well as every subsequent bounded observation.
    // Only booleans cross the host boundary; no raw tree, labels or field values.
    func security(_ app: XCUIApplication, product: String) throws {
        guard !rejected else { throw Failure.privacy }
        let other = configuration.accounts[products.first { $0 != product }!]!
        let privateValues = [other.name, other.email, other.buildingName, other.productTitle]
        let passwords = [configuration.oldPassword, configuration.newPassword, "DefinitelyWrong123"]
        for element in app.descendants(matching: .any).allElementsBoundByIndex {
            let text = element.label + " " + ((element.value as? String) ?? "")
            if privateValues.contains(where: { text.contains($0) }) { try reject("private-identity") }
            if passwords.contains(where: {
                let stripped = $0.trimmingCharacters(in: .whitespaces)
                return text.contains($0) || text.contains(String(stripped.prefix(12))) || text.contains(String(stripped.suffix(12)))
            }) {
                try reject("credential-exposure")
            }
            if text.range(of: #"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9_-]{64,}"#, options: .regularExpression) != nil {
                try reject("credential-exposure")
            }
            if passwordLabels.contains(element.label) && element.elementType == .textField {
                try reject("unprotected-password-field")
            }
        }
    }

    func wait(_ app: XCUIApplication, product: String, ready: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(50)
        repeat {
            try security(app, product: product)
            if try ready() { return }
            Thread.sleep(forTimeInterval: 0.5)
        } while Date() < deadline
        throw Failure.screen
    }

    func checkpoint(_ app: XCUIApplication, product: String, phase: String, ready: () throws -> Bool) throws {
        try wait(app, product: product, ready: ready)
        let reply = try host("checkpoint", payload: ["app": product, "phase": phase,
                    "checks": ["privacy": true, "screen": true, "secure": true]])
        guard let nonce = reply["nonce"] else { throw Failure.transport }
        // DB/proxy validation may take time. Recheck the native tree AFTER that
        // boundary, then capture the app itself immediately, without an action.
        guard try ready() else { throw Failure.screen }
        try security(app, product: product)
        guard app.state == .runningForeground else { throw Failure.state }
        let image = app.screenshot().pngRepresentation
        try host("capture", payload: ["app": product, "phase": phase, "nonce": nonce,
                    "checks": ["privacy": true, "screen": true, "secure": true], "png": image.base64EncodedString()])
    }

    func button(_ app: XCUIApplication, product: String, label: String) throws -> XCUIElement {
        let target = app.buttons[label]
        for index in 0..<9 {
            try security(app, product: product)
            if target.exists && target.isHittable && target.isEnabled { return target }
            if index < 8 {
                label == "Voltar ao aplicativo" ? app.swipeDown() : app.swipeUp()
                Thread.sleep(forTimeInterval: 0.3)
            }
        }
        throw Failure.screen
    }

    func field(_ app: XCUIApplication, product: String, label: String, secure: Bool) throws -> XCUIElement {
        let target = secure ? app.secureTextFields[label] : app.textFields[label]
        for index in 0..<9 {
            try security(app, product: product)
            if target.exists && target.isHittable { return target }
            if index < 8 { app.swipeUp(); Thread.sleep(forTimeInterval: 0.3) }
        }
        throw Failure.screen
    }

    func emptyLogin(_ app: XCUIApplication) -> Bool {
        let email = app.textFields["E-mail"], password = app.secureTextFields["Senha"]
        return email.exists && password.exists && (email.value as? String ?? "").isEmpty &&
            (password.value as? String ?? "").isEmpty && app.buttons["Entrar"].exists
    }

    func ownProfile(_ app: XCUIApplication, product: String) -> Bool {
        let account = configuration.accounts[product]!
        return app.staticTexts[account.productTitle].exists && app.staticTexts[account.name].exists &&
            app.staticTexts[account.email].exists && app.buttons["Minha conta"].exists && app.buttons["Sair"].exists
    }

    func launch(_ app: XCUIApplication) {
        app.launchArguments = ["-AppleLanguages", "(pt-BR)", "-AppleLocale", "pt_BR"]
        app.launch()
    }

    func login(_ app: XCUIApplication, product: String, password: String, phase: String, rejectedLogin: Bool = false) throws {
        try wait(app, product: product) { self.emptyLogin(app) }
        let email = try field(app, product: product, label: "E-mail", secure: false)
        email.tap(); email.typeText(configuration.accounts[product]!.email)
        let secret = try field(app, product: product, label: "Senha", secure: true)
        secret.tap(); secret.typeText(password) // Literal leading/trailing spaces intentionally preserved.
        try button(app, product: product, label: "Entrar").tap()
        if rejectedLogin {
            try checkpoint(app, product: product, phase: phase) { app.staticTexts["E-mail ou senha inválidos"].exists }
        } else {
            try checkpoint(app, product: product, phase: phase) { self.ownProfile(app, product: product) }
        }
    }

    func openAccount(_ app: XCUIApplication, product: String) throws {
        try button(app, product: product, label: "Minha conta").tap()
        try wait(app, product: product) { app.staticTexts["Trocar minha senha"].exists && self.ownProfile(app, product: product) }
    }

    func accountFields(_ app: XCUIApplication, product: String, empty: Bool) throws -> Bool {
        for label in ["Senha atual", "Nova senha", "Confirmar nova senha"] {
            let secret = try field(app, product: product, label: label, secure: true)
            guard let value = secret.value as? String, value.isEmpty == empty else { return false }
        }
        return true
    }

    func fill(_ app: XCUIApplication, product: String, current: String) throws {
        for (label, value) in [("Senha atual", current), ("Nova senha", configuration.newPassword), ("Confirmar nova senha", configuration.newPassword)] {
            let secret = try field(app, product: product, label: label, secure: true)
            secret.tap(); secret.typeText(value)
        }
    }

    func maskedSignatures(_ app: XCUIApplication, product: String) throws -> [String: String] {
        var values: [String: String] = [:]
        for label in ["Senha atual", "Nova senha", "Confirmar nova senha"] {
            let secret = try field(app, product: product, label: label, secure: true)
            guard let value = secret.value as? String, !value.isEmpty else { throw Failure.state }
            values[label] = value // Private masked accessibility values; never printed/exported.
        }
        return values
    }

    func testBothInstalledReleaseApps() throws {
        continueAfterFailure = false
        guard let data = Data(base64Encoded: AuthConfiguration.encoded) else { throw Failure.configuration }
        configuration = try JSONDecoder().decode(Configuration.self, from: data)
        guard Set(configuration.accounts.keys) == Set(products), configuration.oldPassword != configuration.newPassword,
              configuration.newPassword.hasPrefix(" "), configuration.newPassword.hasSuffix(" ") else { throw Failure.configuration }
        let applications = Dictionary(uniqueKeysWithValues: products.map { ($0, XCUIApplication(bundleIdentifier: bundles[$0]!)) })
        try host("start", payload: [:])
        for product in products {
            let app = applications[product]!
            launch(app)
            try checkpoint(app, product: product, phase: "00-empty") { self.emptyLogin(app) }
            try login(app, product: product, password: configuration.oldPassword, phase: "01-login")
        }
        for product in products {
            let app = applications[product]!
            app.activate()
            try wait(app, product: product) { self.ownProfile(app, product: product) }
            try openAccount(app, product: product)
            guard try accountFields(app, product: product, empty: true) else { throw Failure.state }
            try checkpoint(app, product: product, phase: "02-account-empty") { app.staticTexts["Trocar minha senha"].exists }
            try fill(app, product: product, current: "DefinitelyWrong123")
            let beforeError = try maskedSignatures(app, product: product)
            try button(app, product: product, label: "Confirmar troca de senha").tap()
            try wait(app, product: product) { app.staticTexts["Não foi possível trocar a senha. Confira a senha atual e use uma nova senha diferente."].exists }
            guard try maskedSignatures(app, product: product) == beforeError else { throw Failure.state }
            try checkpoint(app, product: product, phase: "03-error-preserved") {
                let afterError = try self.maskedSignatures(app, product: product)
                return app.staticTexts["Trocar minha senha"].exists && afterError == beforeError
            }
            // Header is above the scroll area. No field value is put into an assertion.
            try button(app, product: product, label: "Voltar ao aplicativo").tap()
            try wait(app, product: product) { self.ownProfile(app, product: product) }
            try openAccount(app, product: product)
            guard try accountFields(app, product: product, empty: true) else { throw Failure.state }
            try checkpoint(app, product: product, phase: "04-cancel-cleared") { app.staticTexts["Trocar minha senha"].exists }
            app.terminate(); launch(app)
            try checkpoint(app, product: product, phase: "05-keychain-restored") { self.ownProfile(app, product: product) }
            try openAccount(app, product: product)
            guard try accountFields(app, product: product, empty: true) else { throw Failure.state }
            try fill(app, product: product, current: configuration.oldPassword)
            try button(app, product: product, label: "Confirmar troca de senha").tap()
            try checkpoint(app, product: product, phase: "06-password-changed") { self.emptyLogin(app) }
            let peerProduct = products.first { $0 != product }!
            let peer = applications[peerProduct]!
            peer.activate()
            // Both journeys are interleaved; the earlier peer has completed logout.
            try checkpoint(peer, product: peerProduct, phase: "07-peer-isolated") {
                peerProduct == "operations-mobile" ? self.ownProfile(peer, product: peerProduct) : self.emptyLogin(peer)
            }
            app.terminate(); launch(app)
            try checkpoint(app, product: product, phase: "08-cold-change-empty") { self.emptyLogin(app) }
            try login(app, product: product, password: configuration.oldPassword, phase: "09-old-rejected", rejectedLogin: true)
            app.terminate(); launch(app)
            try login(app, product: product, password: configuration.newPassword, phase: "10-new-literal-login")
            try button(app, product: product, label: "Sair").tap()
            try checkpoint(app, product: product, phase: "11-logout") { self.emptyLogin(app) }
            app.terminate(); launch(app)
            try checkpoint(app, product: product, phase: "12-cold-logout-empty") { self.emptyLogin(app) }
        }
        try host("finish", payload: [:])
    }
}
