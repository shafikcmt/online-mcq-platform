import * as Linking from "expo-linking";
import { FileText, Megaphone } from "lucide-react-native";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { API_BASE_URL } from "@/api/client";
import { describeError } from "@/api/describe";
import { AppText } from "@/components/app-text";
import { Button } from "@/components/button";
import { useToast } from "@/components/toast";
import { formatDateTime } from "@/lib/format";
import { useRemote } from "@/lib/use-remote";
import { colors, radius, space } from "@/theme";

import { fetchExamNotices, fetchNoticePdfLink } from "./api";
import type { Notice } from "./types";

/** The notices the admin wrote about one exam (a room or time change, a result note), on that
 * exam's own screen. Nothing is shown when there are none or when they cannot be loaded: the exam
 * screen never waits on them. A notice's PDF opens in the phone's viewer. */
export function ExamNotices({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const notify = useToast();
  const load = useCallback(() => fetchExamNotices(slug).catch(() => [] as Notice[]), [slug]);
  const notices = useRemote(load).data ?? [];
  const [opening, setOpening] = useState<number | null>(null);

  async function openPdf(notice: Notice) {
    if (opening !== null) return;
    setOpening(notice.id);
    try {
      const { path } = await fetchNoticePdfLink(notice.id);
      await Linking.openURL(`${API_BASE_URL}${path}`);
    } catch (error) {
      notify(describeError(error, t));
    } finally {
      setOpening(null);
    }
  }

  if (!notices.length) return null;
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Megaphone size={18} color={colors.warning700} />
        <AppText weight="bold" role="heading">
          {t("notifications:examNotices")}
        </AppText>
      </View>
      {notices.map((notice) => (
        <View key={notice.id} style={styles.card}>
          <AppText weight="bold">{notice.title}</AppText>
          <AppText variant="small">{notice.body}</AppText>
          {notice.pdf?.available ? (
            <Button
              label={opening === notice.id ? t("notifications:openingPdf") : t("notifications:openPdf")}
              variant="secondary"
              compact
              disabled={opening !== null}
              onPress={() => void openPdf(notice)}
              icon={<FileText size={18} color={colors.brand700} />}
            />
          ) : null}
          <AppText variant="caption" color={colors.inkSubtle}>
            {formatDateTime(notice.published_at, i18n.language)}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  heading: { flexDirection: "row", alignItems: "center", gap: space.sm },
  card: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.accent500,
    borderLeftWidth: 4,
    backgroundColor: colors.warning50,
  },
});
