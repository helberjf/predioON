import Foundation
import Vision

// Read the real screenshot; a live process with a configuration error is not a
// successful startup form. OCR supplements, but never replaces, visual review.
guard CommandLine.arguments.count == 3 else { fatalError("Expected screenshot and bundle ID") }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let bundle = CommandLine.arguments[2]
let products = ["com.predioon.resident": "Predio ON Morador", "com.predioon.operations": "Predio ON Operacao"]
guard let title = products[bundle] else { fatalError("Unexpected product") }
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["pt-BR", "en-US"]
try VNImageRequestHandler(url: url, options: [:]).perform([request])
let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
func normalized(_ value: String) -> String {
    value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pt_BR"))
        .replacingOccurrences(of: "[^a-z0-9]", with: "", options: .regularExpression)
}
let visible = lines.map(normalized).joined()
let required = [title, "E-mail", "Senha", "Entrar"]
let missing = required.filter { !visible.contains(normalized($0)) }
let result: [String: Any] = ["passed": missing.isEmpty, "required": required, "missing": missing, "recognized": lines]
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
print(String(decoding: data, as: UTF8.self))
if !missing.isEmpty {
    FileHandle.standardError.write(Data("Expected login form is absent from the real screenshot\n".utf8))
    exit(1)
}
