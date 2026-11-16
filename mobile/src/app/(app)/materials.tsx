import * as Linking from "expo-linking";
import { FileText, Play } from "lucide-react-native";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { PagedList } from "@/components/paged-list";
import { Segmented } from "@/components/segmented";
import { EmptyNote } from "@/features/dashboard/section";
import { fetchMaterials, materialPdfUrl, youtubeWatchUrl, type MaterialKind } from "@/features/materials/api";
import type { Material } from "@/features/materials/types";
import { usePages, type Page } from "@/lib/use-pages";
import { colors, space } from "@/theme";

const KINDS: MaterialKind[] = ["all", "video", "pdf"];
const keyOf = (item: Material) => String(item.id);

/** Study materials: YouTube videos and PDF handouts for everyone (no sign-in needed). A video opens
 * in the YouTube app or browser; a PDF opens in the phone's viewer. */
export default function MaterialsScreen() {
  const { t } = useTranslation();
  // `exam` (a slug): only that exam's materials. `kind`: the tab to open on (from Home's study section).
  const { exam = "", kind: opened } = useLocalSearchParams<{ exam?: string; kind?: string }>();
  const [kind, setKind] = useState<MaterialKind>(opened === "video" || opened === "pdf" ? opened : "all");
  const load = useCallback((page: number) => fetchMaterials(kind, page, exam), [kind, exam]);
  const list = usePages<Material, Page<Material>>(load, `${kind}|${exam}`, keyOf);

  const header = (
    <>
      <PageHeader title={t("materials:title")} subtitle={exam ? t("materials:forExam") : t("materials:subtitle")} />
      <Segmented label={t("materials:filter")} value={kind} onChange={setKind} options={KINDS.map((value) => ({ value, label: t(`materials:kinds.${value}`) }))} />
    </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <PagedList<Material>
        testID="material-list"
        list={list}
        keyOf={keyOf}
        header={header}
        empty={<EmptyNote text={t("materials:empty")} />}
        renderItem={({ item }) => <MaterialRow item={item} />}
      />
    </SafeAreaView>
  );
}

function MaterialRow({ item }: { item: Material }) {
  const { t } = useTranslation();
  const video = item.kind === "video";
  const watch = video ? youtubeWatchUrl(item.youtube_id) : null;
  const place = [item.category?.name, item.subject?.name].filter(Boolean).join(" · ");
  return (
    <Card style={styles.card}>
      <View style={styles.meta}>
        <Badge label={video ? t("materials:kinds.video") : t("materials:kinds.pdf")} tone={video ? "info" : "neutral"} />
        {place ? (
          <AppText variant="caption" color={colors.inkSubtle}>
            {place}
          </AppText>
        ) : null}
      </View>
      <AppText weight="bold">{item.title}</AppText>
      {item.description ? (
        <AppText variant="small" color={colors.inkMuted}>
          {item.description}
        </AppText>
      ) : null}
      {item.teacher ? (
        <AppText variant="small" color={colors.inkMuted}>
          {t("materials:teacher", { name: item.teacher })}
        </AppText>
      ) : null}
      {watch ? (
        <Button
          label={t("materials:watch")}
          accessibilityLabel={t("materials:watchTitle", { title: item.title })}
          variant="secondary"
          onPress={() => void Linking.openURL(watch).catch(() => undefined)}
          icon={<Play size={18} color={colors.brand700} />}
        />
      ) : null}
      {!video && item.pdf.available ? (
        <Button
          label={t("materials:openPdf")}
          accessibilityLabel={t("materials:openPdfTitle", { title: item.title })}
          variant="secondary"
          onPress={() => void Linking.openURL(materialPdfUrl(item.id)).catch(() => undefined)}
          icon={<FileText size={18} color={colors.brand700} />}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  card: { gap: space.xs },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
});
