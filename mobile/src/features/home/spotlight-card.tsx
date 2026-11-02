import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { formatDateTime } from "@/lib/format";
import { serverNow } from "@/lib/server-clock";
import { localizeDigits } from "@/lib/text";
import { colors, radius, space } from "@/theme";

import { splitCountdown } from "./countdown";
import type { Spotlight } from "./spotlight";

const NAVY = "#0A1E5E";
const ROYAL = "#1250E4";
const RED = "#E5383B";

/** The featured exam at the top of Home: a live or open exam the student can join now, or
 * the next upcoming one, with a live countdown (server clock, every second) and one clear
 * action. Brand gradient drawn with SVG (no image). */
export function SpotlightCard({ spotlight }: { spotlight: Spotlight }) {
  const { t, i18n } = useTranslation();
  const { exam, state } = spotlight;
  const lang = i18n.language;
  const n = (value: number | string) => localizeDigits(value, lang);
  const now = useSecondTicker();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const target = state === "upcoming" ? exam.start_at : exam.end_at;
  const left = target ? splitCountdown(Date.parse(target), now) : null;
  const units = left
    ? left.days > 0
      ? [
          [left.days, t("home:spotlight.units.days")],
          [left.hours, t("home:spotlight.units.hours")],
          [left.minutes, t("home:spotlight.units.minutes")],
        ]
      : [
          [left.hours, t("home:spotlight.units.hours")],
          [left.minutes, t("home:spotlight.units.minutes")],
          [left.seconds, t("home:spotlight.units.seconds")],
        ]
    : null;

  const when =
    state === "upcoming" && exam.start_at
      ? t("home:spotlight.startsAt", { time: formatDateTime(exam.start_at, lang) })
      : exam.end_at
        ? t("home:spotlight.endsAt", { time: formatDateTime(exam.end_at, lang) })
        : t("home:spotlight.duration", { n: n(exam.duration_minutes) });
  const action = exam.can_resume ? t("home:spotlight.resume") : state === "upcoming" ? t("home:spotlight.details") : t("home:spotlight.join");

  return (
    <View
      style={styles.card}
      onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
    >
      {size.width > 0 ? (
        <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id="spot" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={NAVY} />
              <Stop offset="1" stopColor={ROYAL} />
            </LinearGradient>
          </Defs>
          <Rect width={size.width} height={size.height} rx={radius.sheet + 4} fill="url(#spot)" />
          <Circle cx={size.width - 24} cy={20} r={70} fill={colors.white} fillOpacity={0.06} />
          <Circle cx={size.width - 70} cy={size.height + 10} r={50} fill={colors.white} fillOpacity={0.05} />
        </Svg>
      ) : null}

      <View style={styles.top}>
        <View style={[styles.badge, state === "live" ? styles.badgeLive : state === "open" ? styles.badgeOpen : styles.badgeSoon]}>
          {state !== "upcoming" ? <View style={styles.pulse} /> : null}
          <AppText variant="caption" weight="bold" color={colors.white}>
            {t(`home:spotlight.state.${state}`)}
          </AppText>
        </View>
        {exam.access_type === "free" ? (
          <View style={styles.free}>
            <AppText variant="caption" weight="bold" color={colors.accent500}>
              {t("home:spotlight.free")}
            </AppText>
          </View>
        ) : null}
      </View>

      <AppText variant="h4" weight="bold" color={colors.white} role="heading">
        {exam.title}
      </AppText>
      <AppText variant="small" color={colors.brand100}>
        {when}
      </AppText>

      {units ? (
        <View
          style={styles.countdown}
          accessible
          accessibilityLabel={`${t(state === "upcoming" ? "home:spotlight.startsIn" : "home:spotlight.endsIn")} ${units
            .map(([value, label]) => `${n(value)} ${label}`)
            .join(" ")}`}
        >
          {units.map(([value, label]) => (
            <View key={String(label)} style={styles.unit}>
              <AppText variant="h4" weight="bold" color={colors.white}>
                {n(String(value).padStart(2, "0"))}
              </AppText>
              <AppText variant="caption" color={colors.brand100}>
                {label}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${action}: ${exam.title}`}
        onPress={() => router.push({ pathname: "/exam/[slug]", params: { slug: exam.slug } })}
        style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
      >
        <AppText weight="bold" color={colors.brand950}>
          {action}
        </AppText>
        <ChevronRight size={18} color={colors.brand950} />
      </Pressable>
    </View>
  );
}

/** Server time, re-read every second (the countdown's own clock). */
function useSecondTicker(): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.sheet + 4,
    padding: space.lg,
    gap: space.sm,
    overflow: "hidden",
    backgroundColor: NAVY,
    shadowColor: ROYAL,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full },
  badgeLive: { backgroundColor: RED },
  badgeOpen: { backgroundColor: colors.success700 },
  badgeSoon: { backgroundColor: "rgba(255,255,255,0.18)" },
  pulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.white },
  free: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full, borderWidth: 1, borderColor: "rgba(242,178,51,0.5)" },
  countdown: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  unit: {
    flex: 1,
    alignItems: "center",
    paddingVertical: space.sm,
    borderRadius: radius.card,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  cta: {
    marginTop: space.sm,
    minHeight: 48,
    borderRadius: radius.card,
    backgroundColor: colors.accent500,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
  },
  pressed: { opacity: 0.85 },
});
