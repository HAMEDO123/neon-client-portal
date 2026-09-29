import Foundation

/// One Server-Sent Event, as the server's streams write them
/// (`event: …` / `data: …` / `id: …`, ended by an empty line).
struct ServerSentEvent {
    let name: String
    let data: String
    let id: String?
}

extension URLSession.AsyncBytes {
    /// The response read as Server-Sent Events.
    ///
    /// Not `lines`: `AsyncLineSequence` silently drops empty lines, and in SSE
    /// the empty line is the only thing that says an event is complete. Read
    /// through `lines`, every event of the calls and chat streams arrived and
    /// none was ever handled — calls stuck at "still connecting" and chat
    /// fell back to its slow poll. This reads the bytes itself.
    func serverSentEvents() -> AsyncThrowingStream<ServerSentEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var line: [UInt8] = []
                var name = "message"
                var data: [String] = []
                var id: String?

                func take(_ raw: [UInt8]) {
                    var bytes = raw
                    if bytes.last == 0x0D { bytes.removeLast() } // CRLF
                    let text = String(decoding: bytes, as: UTF8.self)

                    if text.isEmpty {
                        if !data.isEmpty {
                            continuation.yield(ServerSentEvent(name: name, data: data.joined(separator: "\n"), id: id))
                        }
                        name = "message"
                        data = []
                        id = nil
                        return
                    }
                    if text.hasPrefix(":") { return } // a keep-alive comment
                    let field: Substring
                    let value: Substring
                    if let colon = text.firstIndex(of: ":") {
                        field = text[..<colon]
                        var rest = text[text.index(after: colon)...]
                        if rest.first == " " { rest = rest.dropFirst() }
                        value = rest
                    } else {
                        field = Substring(text)
                        value = ""
                    }
                    switch field {
                    case "event": name = String(value)
                    case "data": data.append(String(value))
                    case "id": id = String(value)
                    default: break // "retry" and anything unknown
                    }
                }

                do {
                    for try await byte in self {
                        if Task.isCancelled { break }
                        if byte == 0x0A {
                            take(line)
                            line.removeAll(keepingCapacity: true)
                        } else {
                            line.append(byte)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
