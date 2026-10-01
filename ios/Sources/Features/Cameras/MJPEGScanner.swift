import Foundation

/// Reads whole JPEG pictures out of an MJPEG byte stream as it arrives, in
/// whatever pieces the network hands over.
///
/// It does not trust the stream's own framing — the `--frame` boundaries and
/// `Content-Length` headers go2rtc writes between pictures are skipped like any
/// other byte. A picture is found by its own markers: it starts at SOI
/// (`FF D8`) and ends at EOI (`FF D9`). And it walks the JPEG's segments to get
/// there, rather than taking the first `FF D9` after a start: a segment's
/// length says where it ends, so an `FF D9` inside a table or an embedded
/// thumbnail is never mistaken for the end, and in the compressed picture data
/// an `FF` is always followed by `00` or a restart marker unless it is a real
/// marker.
///
/// Foundation only, so the same file can be compiled into a command-line check
/// against a live stream.
struct MJPEGScanner {
    /// A picture larger than this is not a camera frame; the stream is out of step.
    static let maxFrameBytes = 8 * 1024 * 1024

    private enum Mode {
        case seeking
        case segments
        case entropy
    }

    private var buffer: [UInt8] = []
    private var cursor = 0
    private var start: Int?
    private var mode: Mode = .seeking

    /// Bytes waiting for the rest of their picture.
    var pendingBytes: Int { buffer.count }

    /// Adds the next piece of the stream; answers every picture it completed.
    mutating func append(_ chunk: Data) -> [Data] {
        buffer.append(contentsOf: chunk)
        var frames: [Data] = []

        parsing: while true {
            switch mode {
            case .seeking:
                guard let soi = findStart(from: cursor) else {
                    // Keep the last two bytes: an FF D8 at the very end may
                    // begin the next picture.
                    cursor = max(cursor, buffer.count - 2)
                    break parsing
                }
                start = soi
                cursor = soi + 2
                mode = .segments

            case .segments:
                guard cursor + 1 < buffer.count else { break parsing }
                guard buffer[cursor] == 0xFF else {
                    resync()
                    continue parsing
                }
                let marker = buffer[cursor + 1]
                switch marker {
                case 0xFF:
                    cursor += 1 // fill byte before a marker
                case 0xD9:
                    emit(endingAt: cursor + 2, into: &frames)
                case 0xD8:
                    // A new picture began before this one ended: start over there.
                    start = cursor
                    cursor += 2
                case 0x01, 0xD0...0xD7:
                    cursor += 2 // markers with no length
                default:
                    guard cursor + 3 < buffer.count else { break parsing }
                    let length = Int(buffer[cursor + 2]) << 8 | Int(buffer[cursor + 3])
                    guard length >= 2 else {
                        resync()
                        continue parsing
                    }
                    let next = cursor + 2 + length
                    guard next <= buffer.count else { break parsing }
                    cursor = next
                    if marker == 0xDA { mode = .entropy } // start of scan: compressed data follows
                }

            case .entropy:
                guard let marker = findMarker(from: cursor) else { break parsing }
                if buffer[marker + 1] == 0xD9 {
                    emit(endingAt: marker + 2, into: &frames)
                } else {
                    // Another table or scan (a progressive picture): back to segments.
                    cursor = marker
                    mode = .segments
                }
            }

            if let start, cursor - start > Self.maxFrameBytes { resync() }
        }

        compact()
        return frames
    }

    /// Forgets everything — for a new connection.
    mutating func reset() {
        buffer.removeAll(keepingCapacity: true)
        cursor = 0
        start = nil
        mode = .seeking
    }

    private mutating func emit(endingAt end: Int, into frames: inout [Data]) {
        if let start { frames.append(Data(buffer[start..<end])) }
        start = nil
        cursor = end
        mode = .seeking
    }

    /// Out of step: drop this picture and look for the next start after it.
    private mutating func resync() {
        cursor = (start ?? cursor) + 1
        start = nil
        mode = .seeking
    }

    private mutating func compact() {
        let keep = min(start ?? cursor, buffer.count)
        guard keep > 0 else { return }
        buffer.removeFirst(keep)
        cursor -= keep
        if let start { self.start = start - keep }
    }

    /// The next `FF D8 FF` at or after `from`.
    private func findStart(from: Int) -> Int? {
        buffer.withUnsafeBufferPointer { bytes in
            var index = max(from, 0)
            while index + 2 < bytes.count {
                if bytes[index] == 0xFF, bytes[index + 1] == 0xD8, bytes[index + 2] == 0xFF { return index }
                index += 1
            }
            return nil
        }
    }

    /// In compressed data: the next `FF` that is a real marker — not `FF 00`
    /// (an escaped FF), not a restart marker, not a fill byte.
    private mutating func findMarker(from: Int) -> Int? {
        let found: (Int?, Int) = buffer.withUnsafeBufferPointer { bytes in
            var index = from
            while index + 1 < bytes.count {
                if bytes[index] == 0xFF {
                    let next = bytes[index + 1]
                    if next == 0x00 || (0xD0...0xD7).contains(next) {
                        index += 2
                        continue
                    }
                    if next == 0xFF {
                        index += 1
                        continue
                    }
                    return (index, index)
                }
                index += 1
            }
            return (nil, index)
        }
        if found.0 == nil { cursor = found.1 } // resume here next time
        return found.0
    }
}
