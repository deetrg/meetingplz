import Foundation
import Security
import AuthenticationServices
import UIKit

enum Config {
    static let base = "https://meetingplz.pages.dev"
    static let refreshTaskId = "com.dai.meetingplz.refresh"
}

struct APIError: LocalizedError {
    var status: Int
    var message: String
    var errorDescription: String? { message }
}

enum Keychain {
    private static let service = "com.dai.meetingplz.session"
    static func get() -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }
    static func set(_ v: String?) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        SecItemDelete(base as CFDictionary)
        guard let v, let d = v.data(using: .utf8) else { return }
        var add = base
        add[kSecValueData as String] = d
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
}

struct APIClient {
    var token: String?

    func request<T: Decodable>(_ method: String, _ path: String, body: Data? = nil, as type: T.Type) async throws -> T {
        let data = try await raw(method, path, body: body)
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError(status: 0, message: "Unexpected response from the server.") }
    }

    @discardableResult
    func raw(_ method: String, _ path: String, body: Data? = nil) async throws -> Data {
        var req = URLRequest(url: URL(string: Config.base + path)!)
        req.httpMethod = method
        req.timeoutInterval = 20
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            throw APIError(status: code, message: code == 401 ? "Signed out. Please sign in again." : "Server error (\(code)).")
        }
        return data
    }

    func me() async throws -> Me { try await request("GET", "/api/me", as: Me.self) }
    func upcoming() async throws -> [MPEvent] { try await request("GET", "/api/upcoming", as: UpcomingResponse.self).events }
    func putSettings(_ s: Settings) async throws -> Settings {
        let body = try JSONEncoder().encode(s)
        return try await request("PUT", "/api/settings", body: body, as: Settings.self)
    }
    func logout() async { _ = try? await raw("POST", "/api/logout") }
    func deleteAccount() async throws { try await raw("DELETE", "/api/me") }
}

@MainActor
final class WebAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = WebAuth()
    private var session: ASWebAuthenticationSession?

    func start() async throws -> String {
        let ret = "meetingplz://auth".addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        let url = URL(string: "\(Config.base)/api/auth/google/start?client=ios&return=\(ret)")!
        let cb: URL = try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "meetingplz") { url, err in
                if let url { cont.resume(returning: url) } else { cont.resume(throwing: err ?? APIError(status: 0, message: "Sign-in cancelled.")) }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            self.session = s
            if !s.start() { cont.resume(throwing: APIError(status: 0, message: "Could not open sign-in.")) }
        }
        session = nil
        let comps = URLComponents(url: cb, resolvingAgainstBaseURL: false)
        for raw in [comps?.fragment, comps?.query] {
            guard let raw else { continue }
            for pair in raw.split(separator: "&") {
                let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
                if kv.count == 2, kv[0] == "token", !kv[1].isEmpty { return kv[1].removingPercentEncoding ?? kv[1] }
                if kv.count == 2, kv[0] == "error" {
                    let msg: String
                    switch kv[1] {
                    case "calendar_access_needed": msg = "MeetingPlz needs permission to read your calendar. Please try again and tick the calendar box."
                    case "access_denied": msg = "Sign-in was cancelled."
                    default: msg = "Google sign-in failed. Please try again."
                    }
                    throw APIError(status: 0, message: msg)
                }
            }
        }
        throw APIError(status: 0, message: "Sign-in did not return a session.")
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            return scene?.keyWindow ?? scene?.windows.first ?? ASPresentationAnchor()
        }
    }
}
