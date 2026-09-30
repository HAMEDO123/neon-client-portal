import Combine
import SwiftUI
import UIKit

/// The share extension's entry point (NSExtensionPrincipalClass): hosts the
/// SwiftUI screen and hands it what was shared and the signed-in session.
final class ShareViewController: UIViewController {
    private var model: ShareModel?
    private var sendingObserver: AnyCancellable?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(Color.neonBg)

        let model = ShareModel(context: extensionContext, token: TokenStore.read())
        self.model = model

        let host = UIHostingController(rootView: ShareRootView(model: model))
        host.view.backgroundColor = .clear
        addChild(host)
        view.addSubview(host.view)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)

        // A sheet swiped away mid-send would drop an upload half-way: while
        // something is going out, only Cancel closes it.
        sendingObserver = model.$sending.sink { [weak self] sending in
            if case .working = sending {
                self?.isModalInPresentation = true
            } else {
                self?.isModalInPresentation = false
            }
        }

        model.start()
    }
}
