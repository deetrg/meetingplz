import SwiftUI
import BackgroundTasks

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        NotificationScheduler.shared.register()
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Config.refreshTaskId, using: nil) { task in
            guard let t = task as? BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
            Task { @MainActor in AppModel.shared.runBackgroundRefresh(t) }
        }
        return true
    }
}

@main
struct MeetingPlzApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var model = AppModel.shared
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .task { await model.handleActive() }
                .onChange(of: phase) { _, p in
                    if p == .active { Task { await model.handleActive() } }
                    if p == .background { model.scheduleBackgroundRefresh() }
                }
        }
    }
}
