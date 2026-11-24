// swift-tools-version:5.9
// NEON Ads inside the NEON app: the marketing screens (campaigns, approvals,
// CRM, lead quality, market, new ad…) as a section of the Mac sidebar.
// They talk to the NEON Ads engine on this Mac (~/neon-ads, dashboard.py on
// 127.0.0.1:8793), so they exist on the Mac only: every file is wrapped in
// `#if targetEnvironment(macCatalyst)` and the iPhone build links an empty
// module. README.md has the whole story.
import PackageDescription

let package = Package(
    name: "NeonAds",
    platforms: [.iOS(.v16), .macCatalyst(.v17)],
    products: [
        .library(name: "NeonAds", targets: ["NeonAds"]),
    ],
    targets: [
        // Shared/ is the engine's models and the widget's views: compiled here and,
        // file by file, into the NeonWidgets extension too (project.yml).
        .target(name: "NeonAds", path: ".", exclude: ["README.md"], sources: ["Sources/NeonAds", "Shared"]),
    ]
)
