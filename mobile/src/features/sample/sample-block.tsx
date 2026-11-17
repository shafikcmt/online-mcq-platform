import { Users } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { formatDecimal } from "@/lib/format";
import { localizeDigits } from "@/lib/text";
import { colors, radius, space } from "@/theme";

import type { SampleList } from "./api";

/** The exam's sample participants, under the real merit list: a heading and note that say they are not
 * real students, a "Sample" label on every row, and no position. */
export function SampleBlock({ data }: { data: SampleList }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  return (
    <View style={styles.block} testID="sample-block">
      <View style={styles.heading}>
        <Users size={18} color={colors.inkMuted} />
        <AppText weight="bold" role="heading">
          {t("results:sample.title")}
        </AppText>
      </View>
      <AppText variant="small" color={colors.inkMuted}>
        {t("results:sample.note", { count: data.count, n: localizeDigits(data.count, language) })}
      </AppText>
      {data.results.map((row, index) => {
        const marks = t("home:result.marks", { obtained: formatDecimal(row.marks, language), total: formatDecimal(data.total_marks, language) });
        return (
          <View key={`${row.name}-${index}`} style={styles.row} accessible accessibilityLabel={t("results:sample.row", { name: row.name, marks })}>
            <View style={styles.who}>
              <View style={styles.name}>
                <AppText weight="semibold" numberOfLines={1} style={styles.nameText}>
                  {row.name}
                </AppText>
                <Badge label={t("results:sample.label")} tone="neutral" />
              </View>
              {row.position_by_marks ? (
                <AppText variant="caption" color={colors.inkMuted}>
                  {t("results:sample.position", { n: localizeDigits(row.position_by_marks, language) })}
                </AppText>
              ) : null}
            </View>
            <AppText weight="semibold">{marks}</AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm, marginTop: space.xl },
  heading: { flexDirection: "row", alignItems: "center", gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, backgroundColor: colors.surface },
  who: { flex: 1, gap: 2 },
  name: { flexDirection: "row", alignItems: "center", gap: space.sm },
  nameText: { flexShrink: 1 },
});
