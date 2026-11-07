import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import {
  NotoSansBengali_400Regular,
  NotoSansBengali_500Medium,
  NotoSansBengali_600SemiBold,
  NotoSansBengali_700Bold,
} from "@expo-google-fonts/noto-sans-bengali";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import "@/i18n";
import { AuthProvider, useAuth } from "@/auth/provider";
import { OfflineScreen } from "@/components/offline-screen";
import { ToastProvider } from "@/components/toast";
import { UpdatePrompt } from "@/features/update/update-prompt";
import { LanguageProvider, useLanguage } from "@/i18n/provider";
import { colors } from "@/theme";

void SplashScreen.preventAutoHideAsync();

/** Root: fonts (bundled), language, session, then three guarded areas:
 * language choice (first launch) → sign-in screens (signed out) → the app (signed in).
 * Expo Router's `Stack.Protected` swaps them when the state changes, so no screen of the
 * signed-in area can be reached without a session. */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    NotoSansBengali_400Regular,
    NotoSansBengali_500Medium,
    NotoSansBengali_600SemiBold,
    NotoSansBengali_700Bold,
  });
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <AuthProvider>
          <ToastProvider>
            <StatusBar style="dark" />
            <RootNavigator fontsReady={fontsLoaded || !!fontError} />
            <UpdatePrompt />
          </ToastProvider>
        </AuthProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { ready, chosen } = useLanguage();
  const { status } = useAuth();
  const booting = !fontsReady || !ready || status === "loading";

  useEffect(() => {
    if (!booting) void SplashScreen.hideAsync();
  }, [booting]);

  if (booting) return null; // the splash screen stays up
  if (status === "offline") return <OfflineScreen />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!chosen}>
        <Stack.Screen name="language" />
      </Stack.Protected>
      <Stack.Protected guard={chosen && status === "signedOut"}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={chosen && status === "signedIn"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}
