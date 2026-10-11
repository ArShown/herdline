import { requireOptionalNativeModule } from 'expo';

type BadgeModule = {
  requestPermission(): Promise<boolean>;
  setCount(count: number): Promise<void>;
};

// Missing on web and on builds made before the module was added.
const native = requireOptionalNativeModule<BadgeModule>('HerdlineBadge');

export async function requestBadgePermission(): Promise<boolean> {
  try {
    return (await native?.requestPermission()) ?? false;
  } catch {
    return false;
  }
}

export async function setBadgeCount(count: number): Promise<void> {
  try {
    await native?.setCount(count);
  } catch {
    // Without permission the badge simply stays as it was.
  }
}
