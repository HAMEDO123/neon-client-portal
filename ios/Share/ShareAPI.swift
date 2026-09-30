import Foundation

// The three calls the share extension makes, to the same routes the app's chat
// uses (src/app/api/mobile/chat/*):
//
//   GET  chat/conversations              the list to pick from
//   POST chat/messages  (JSON)           {conversation, body}: text and links
//   POST chat/messages  (multipart)      conversation, body (the caption),
//                                        and the file as `photo` or `document`
//
// None of them needs to know which side is signing in: the server reads that
// from the token, so the Identity the app keeps in its own UserDefaults is not
// needed here.

/// One conversation as `chat/conversations` answers it — only what the picker
/// shows. The server sends them in the app's order: pinned first, then by the
/// newest message.
struct ShareConversation: Decodable, Identifiable, Equatable {
    /// "team", "manager", somebody's id or "g-<groupId>": what `chat/messages` takes.
    let slug: String
    let title: String
    let subtitle: String?
    let avatar: String?
    let isGroup: Bool
    let pinned: Bool
    let online: Bool
    let memberCount: Int?

    var id: String { slug }

    private enum CodingKeys: String, CodingKey {
        case slug, title, subtitle, avatar, isGroup, pinned, online, memberCount
    }

    init(slug: String, title: String, subtitle: String? = nil, avatar: String? = nil, isGroup: Bool = false,
         pinned: Bool = false, online: Bool = false, memberCount: Int? = nil) {
        self.slug = slug
        self.title = title
        self.subtitle = subtitle
        self.avatar = avatar
        self.isGroup = isGroup
        self.pinned = pinned
        self.online = online
        self.memberCount = memberCount
    }

    // Read leniently, as the app does: a field the server added later is
    // never a reason to show nothing.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        slug = try container.decode(String.self, forKey: .slug)
        title = try container.decode(String.self, forKey: .title)
        subtitle = try? container.decodeIfPresent(String.self, forKey: .subtitle)
        avatar = try? container.decodeIfPresent(String.self, forKey: .avatar)
        isGroup = (try? container.decodeIfPresent(Bool.self, forKey: .isGroup)) ?? false
        pinned = (try? container.decodeIfPresent(Bool.self, forKey: .pinned)) ?? false
        online = (try? container.decodeIfPresent(Bool.self, forKey: .online)) ?? false
        memberCount = try? container.decodeIfPresent(Int.self, forKey: .memberCount)
    }
}

enum ShareError: LocalizedError {
    case network
    /// The token was refused: the person was signed out, or it expired.
    case unauthorized
    /// The server said no, in a sentence worth showing ("File is too large…").
    case refused(String)
    case server(Int)
    case decoding
    /// Something shared could not be read off the phone.
    case unreadable(String)
    /// Over the server's limit for its kind, even after shrinking.
    case tooLarge(String)
    case unsupported(String)

    var errorDescription: String? {
        switch self {
        case .network: return L("Can't reach the studio server. Check the connection and try again.")
        case .unauthorized: return L("You have been signed out. Open NEON and sign in again.")
        case .refused(let message): return message
        case .server(let code): return L("The server had a problem (%d). Try again.", code)
        case .decoding: return L("The server answered in a shape this version doesn't understand. Update NEON.")
        case .unreadable(let name): return L("Couldn't read “%@” on this iPhone.", name)
        case .tooLarge(let name): return L("“%@” is over the chat's 50 MB limit, even made smaller.", name)
        case .unsupported(let name): return L("“%@” can't go in the chat. It takes photos, videos, PDF, Word, Excel, ZIP and DWG files.", name)
        }
    }

    /// About one thing being shared, rather than the connection or the session:
    /// it can be skipped and the rest still sent.
    var isAboutTheItem: Bool {
        switch self {
        case .unreadable, .tooLarge, .unsupported, .refused: return true
        case .network, .unauthorized, .server, .decoding: return false
        }
    }
}

/// A file ready to go up, already in the shape the server keeps.
struct ShareUpload {
    /// "photo" or "document" — the web chat box's field names, read by the
    /// server's readChatAttachment.
    let field: String
    let filename: String
    let mimeType: String
    let file: URL
}

final class ShareAPI {
    private let token: String
    // The studio's own PC serves the platform, through a Cloudflare tunnel.
    private let baseURL = URL(string: "https://clients.neonjo.com/api/mobile")!
    private let session: URLSession

    init(token: String) {
        self.token = token
        // Nothing of the studio's is left on disk by the extension: no cookies,
        // no cached answers.
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 180
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: config)
    }

    func conversations() async throws -> [ShareConversation] {
        struct Wrapper: Decodable { let conversations: [ShareConversation] }
        let data = try await send(URLRequest(url: baseURL.appendingPathComponent("chat/conversations")))
        do {
            return try JSONDecoder().decode(Wrapper.self, from: data).conversations
        } catch {
            throw ShareError.decoding
        }
    }

    func sendText(conversation: String, body: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("chat/messages"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["conversation": conversation, "body": body])
        _ = try await send(request)
    }

    /// One file into one conversation, with the caption when there is one.
    ///
    /// The multipart body is written to a file and streamed from there: a
    /// 50 MB video held in memory twice over (the file and the body) would get
    /// the extension killed — iOS gives an extension a small fraction of what
    /// an app may use.
    func sendFile(conversation: String, caption: String?, upload: ShareUpload, progress: @escaping @Sendable (Double) -> Void) async throws {
        let boundary = "neon-\(UUID().uuidString)"
        let bodyURL = FileManager.default.temporaryDirectory.appendingPathComponent("upload-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: bodyURL) }
        try writeMultipart(to: bodyURL, boundary: boundary, conversation: conversation, caption: caption, upload: upload)

        var request = URLRequest(url: baseURL.appendingPathComponent("chat/messages"))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        _ = try await send(request, bodyFile: bodyURL, progress: progress)
    }

    private func writeMultipart(to url: URL, boundary: String, conversation: String, caption: String?, upload: ShareUpload) throws {
        guard FileManager.default.createFile(atPath: url.path, contents: nil),
              let out = try? FileHandle(forWritingTo: url),
              let input = try? FileHandle(forReadingFrom: upload.file)
        else { throw ShareError.unreadable(upload.filename) }
        defer {
            try? out.close()
            try? input.close()
        }

        func write(_ string: String) throws { try out.write(contentsOf: Data(string.utf8)) }

        var fields = [("conversation", conversation)]
        if let caption, !caption.isEmpty { fields.append(("body", caption)) }
        for (name, value) in fields {
            try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
        }
        // Quotes and line breaks in a name would end the header early.
        let safeName = upload.filename
            .replacingOccurrences(of: "\"", with: "'")
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
        try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(upload.field)\"; filename=\"\(safeName)\"\r\n")
        try write("Content-Type: \(upload.mimeType)\r\n\r\n")
        // A megabyte at a time, so the file is never in memory whole.
        while true {
            let chunk = try autoreleasepool { try input.read(upToCount: 1 << 20) }
            guard let chunk, !chunk.isEmpty else { break }
            try out.write(contentsOf: chunk)
        }
        try write("\r\n--\(boundary)--\r\n")
    }

    /// Sends one request and returns the body of a 2xx answer. A refusal
    /// carries the server's own sentence, as it does in the app.
    private func send(_ request: URLRequest, bodyFile: URL? = nil, progress: (@Sendable (Double) -> Void)? = nil) async throws -> Data {
        var request = request
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let data: Data
        let response: URLResponse
        do {
            if let bodyFile {
                let delegate = ShareUploadProgress(progress ?? { _ in })
                (data, response) = try await session.upload(for: request, fromFile: bodyFile, delegate: delegate)
            } else {
                (data, response) = try await session.data(for: request)
            }
        } catch {
            if Task.isCancelled { throw CancellationError() }
            throw ShareError.network
        }
        guard let http = response as? HTTPURLResponse else { throw ShareError.network }

        switch http.statusCode {
        case 200..<300:
            return data
        case 401:
            throw ShareError.unauthorized
        case 413:
            throw ShareError.refused(L("That file is too large for the server."))
        default:
            struct ServerError: Decodable { let error: String }
            if let message = try? JSONDecoder().decode(ServerError.self, from: data).error {
                throw ShareError.refused(message)
            }
            throw ShareError.server(http.statusCode)
        }
    }
}

/// How much of an upload has gone, for the progress bar.
private final class ShareUploadProgress: NSObject, URLSessionTaskDelegate {
    private let report: @Sendable (Double) -> Void

    init(_ report: @escaping @Sendable (Double) -> Void) {
        self.report = report
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        report(min(1, Double(totalBytesSent) / Double(totalBytesExpectedToSend)))
    }
}
