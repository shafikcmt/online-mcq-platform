import { Tabs } from "expo-router/js-tabs";
import { House, UserRound } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { colors, fontFamily } from "@/theme";

/** Bottom tabs. Phase-1 plan: Home · Exams · Results · Packages · Profile — the other tabs
 * are added with their screens in the next Mobile App slices. */
export default function TabsLayout() {
  const { t, i18n } = useTranslation();
  const family = fontFamily[i18n.language === "bn" ? "bengali" : "latin"].medium;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand700,
        tabBarInactiveTintColor: colors.inkSubtle,
        tabBarLabelStyle: { fontFamily: family, fontSize: 12 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, minHeight: 60 },
      }}
    >
      <Tabs.Screen name="home" options={{ title: t("tabs.home"), tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: t("tabs.profile"), tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }} />
    </Tabs>
  );
}
