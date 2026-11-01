import SwiftUI

@main
struct EasyRideDriverApp: App {
    var body: some Scene {
        WindowGroup {
            DriverWebView()
                .ignoresSafeArea(edges: .bottom)
        }
    }
}
