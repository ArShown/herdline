import ExpoModulesCore
import UserNotifications

// Only the badge permission is asked for, so no push entitlement is needed and a free signing team still works.
public class HerdlineBadgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdlineBadge")

    AsyncFunction("requestPermission") { () async throws -> Bool in
      try await UNUserNotificationCenter.current().requestAuthorization(options: [.badge])
    }

    AsyncFunction("setCount") { (count: Int) async throws in
      try await UNUserNotificationCenter.current().setBadgeCount(max(count, 0))
    }
  }
}
