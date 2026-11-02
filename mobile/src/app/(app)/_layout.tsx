import { Stack } from "expo-router";

import { colors } from "@/theme";

export const unstable_settings = { anchor: "(tabs)" };

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      {/* No swipe-back out of a running exam: leaving asks first (the timer keeps running). */}
      <Stack.Screen name="attempt/[id]" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
