import SwiftUI

// The calls area's contract with the rest of the app:
// - `CallButtons(slug:title:)` sits in a conversation's header (the chat area
//   places it) and starts a voice or video call in that conversation;
// - `CallOverlay()` is mounted once at the app's root and shows a ringing or
//   running call above everything.

struct CallButtons: View {
    let slug: String
    let title: String
    var body: some View { EmptyView() }
}

struct CallOverlay: View {
    var body: some View { EmptyView() }
}
