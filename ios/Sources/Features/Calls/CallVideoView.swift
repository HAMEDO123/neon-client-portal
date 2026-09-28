import SwiftUI
import WebRTC

/// One video track, rendered with Metal — wraps RTCMTLVideoView. `mirror` is
/// for this device's own front camera, matching the web's local preview.
struct CallVideoView: UIViewRepresentable {
    let track: RTCVideoTrack?
    var mirror = false
    var contentMode: UIView.ContentMode = .scaleAspectFill

    func makeUIView(context: Context) -> RTCMTLVideoView {
        let view = RTCMTLVideoView()
        view.videoContentMode = contentMode
        view.transform = mirror ? CGAffineTransform(scaleX: -1, y: 1) : .identity
        return view
    }

    func updateUIView(_ uiView: RTCMTLVideoView, context: Context) {
        uiView.videoContentMode = contentMode
        uiView.transform = mirror ? CGAffineTransform(scaleX: -1, y: 1) : .identity
        if context.coordinator.track !== track {
            context.coordinator.track?.remove(uiView)
            track?.add(uiView)
            context.coordinator.track = track
        }
    }

    static func dismantleUIView(_ uiView: RTCMTLVideoView, coordinator: Coordinator) {
        coordinator.track?.remove(uiView)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var track: RTCVideoTrack?
    }
}
