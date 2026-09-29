import SwiftUI

#if !DEBUG
extension View {
    /// Screenshot scrolling (App/DebugScreens.swift) is Debug only; in a
    /// Release build this does nothing, so screens can call it unguarded.
    func debugScroll(_ proxy: ScrollViewProxy) -> some View { self }
}
#endif
