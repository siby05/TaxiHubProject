# EasyRide Driver for iPhone — private native shell

This is a **SwiftUI/WKWebView native iOS app source project**, wrapping the existing authenticated driver dashboard at https://easyridenz.com/driver. It uses the website's current branding, booking flows and backend. No separate backend or App Store listing is needed.

## Build and install privately

1. On a Mac, install Xcode 16 or later.
2. Open Xcode → File → New → Project → iOS App. Product Name: `EasyRideDriver`; Interface: SwiftUI; Language: Swift.
3. Replace the generated app entry point with `EasyRideDriverApp.swift` and add `DriverWebView.swift` to the app target. Remove the default ContentView if unused.
4. Set bundle identifier to your own unique identifier, e.g. `nz.easyride.driver`. Set minimum iOS deployment target to iOS 16.4 or later.
5. In Signing & Capabilities choose your Apple team and automatic signing.
6. Connect your iPhone to the Mac, select it as the build destination and press Run. If prompted, enable Developer Mode in iPhone Settings → Privacy & Security and trust your developer certificate.
7. Set Display Name to **EasyRide Driver** and use the **existing approved EasyRide icon** from the website's brand assets. Do not generate or substitute a logo.

A free personal Apple ID may allow device builds with limited provisioning validity and capabilities. For ongoing device installation, a paid Apple Developer Program membership is recommended. Private TestFlight testing still uses App Store Connect and Apple review processes, even though the app need not be publicly listed.

## Scope and limitations

- Reuses live website login, driver bookings, trip updates and links.
- Navigation, phone, SMS, mail and WhatsApp links can open externally.
- **Not yet implemented**: native push notifications, continuous background GPS, offline booking sync, native upload handling, and universal/deep links.
- iOS may suspend WKWebView in the background. Existing website notifications and GPS polling **must not** be represented as reliable native background services.
- This repository does not contain an Xcode project file or a signed IPA. The two Swift files must be added to an Xcode iOS App target before compiling. No macOS/Xcode build was performed in this environment.
- For reliable native background features, a follow-up native API client, APNs registration, and properly permissioned CoreLocation background service will be required.

## Security

Only the official HTTPS EasyRide domain loads inside the app; external links open in the system browser/app. Driver credentials are entered into the existing authenticated website, not stored in custom Swift code. Do not commit Apple certificates, private keys, provisioning profiles, or tokens.
