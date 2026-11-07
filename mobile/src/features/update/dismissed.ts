import AsyncStorage from "@react-native-async-storage/async-storage";

/** "Later" is remembered per version: the notice for 0.2.0 does not come back every launch,
 * but a newer version (0.3.0) asks again. A required update can never be dismissed. */
const KEY = "mcq.update.dismissed";

export async function dismissedVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function dismissVersion(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, version);
  } catch {
    // storage unavailable: the notice may simply show again
  }
}
