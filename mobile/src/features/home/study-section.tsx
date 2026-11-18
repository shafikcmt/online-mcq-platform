import { router } from "expo-router";
import { FileText, PlayCircle, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { fetchMaterials } from "@/features/materials/api";
import { useRemote } from "@/lib/use-remote";
import { colors, space } from "@/theme";

import { Panel, panelStyles } from "./panel";

const TILES: { kind: "video" | "pdf"; Icon: LucideIcon }[] = [
  { kind: "video", Icon: PlayCircle },
  { kind: "pdf", Icon: FileText },
];

/** How many published videos and PDFs there are (two tiny public requests; a failure counts as none). */
async function fetchCounts(): Promise<Record<"video" | "pdf", number>> {
  const count = (kind: "video" | "pdf") => fetchMaterials(kind, 1).then((page) => page.count, () => 0);
  const [video, pdf] = await Promise.all([count("video"), count("pdf")]);
  return { video, pdf };
}

/** The study section of Home: video lessons and PDF notes. Each tile stacks its icon, name and a
 * "Coming soon" note (one line, never broken in two) so it reads well on narrow phones. A part with
 * nothing published yet cannot be opened; it opens by itself as soon as the admin publishes something. */
export function StudySection() {
  const { t } = useTranslation();
  const { data } = useRemote(fetchCounts);
  return (
    <Panel title={t("home:study.title")}>
      <View style={panelStyles.grid}>
        {TILES.map(({ kind, Icon }) => {
          const ready = (data?.[kind] ?? 0) > 0;
          const name = t(`home:study.${kind}`);
          return (
            <Pressable
              key={kind}
              accessibilityRole="link"
              accessibilityLabel={ready ? name : `${name}, ${t("home:study.soon")}`}
              accessibilityState={{ disabled: !ready }}
              disabled={!ready}
              onPress={() => router.push({ pathname: "/materials", params: { kind } })}
              style={({ pressed }) => [panelStyles.tile, styles.tile, !ready && styles.idle, pressed && panelStyles.pressed]}
            >
              <View style={[panelStyles.icon, !ready && styles.iconIdle]}>
                <Icon size={22} color={ready ? colors.brand700 : colors.inkSubtle} />
              </View>
              <AppText variant="small" weight="semibold" color={ready ? colors.ink : colors.inkMuted} numberOfLines={1}>
                {name}
              </AppText>
              {ready ? null : (
                <AppText variant="caption" weight="semibold" color={colors.warning700} numberOfLines={1}>
                  {t("home:study.soon")}
                </AppText>
              )}
            </Pressable>
          );
        })}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  tile: { flexDirection: "column", alignItems: "flex-start", gap: space.xs, minHeight: 0 },
  idle: { backgroundColor: colors.canvas },
  iconIdle: { backgroundColor: colors.line },
});
