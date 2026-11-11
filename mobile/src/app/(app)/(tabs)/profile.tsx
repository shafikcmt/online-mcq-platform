import { router } from "expo-router";
import { BadgeCheck, ChevronRight, KeyRound, LogOut, PencilLine } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/auth/provider";
import { AppText } from "@/components/app-text";
import { Card } from "@/components/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LanguagePicker } from "@/components/language-picker";
import { NotificationsRow } from "@/features/push/notifications-row";
import { Screen } from "@/components/screen";
import { useToast } from "@/components/toast";
import type { Language } from "@/i18n";
import { useLanguage } from "@/i18n/provider";
import { formatDate } from "@/lib/format";
import { formatBdMobile } from "@/lib/phone";
import { localizeDigits } from "@/lib/text";
import { colors, radius, space, touchTarget } from "@/theme";

/** Profile & settings: own details (the student's own phone is shown in full — it is
 * theirs), language (instant; saved on the phone and to the account), edit profile,
 * change password, sign out. */
export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const { user, updateProfile, signOut } = useAuth();
  const { language, setLanguage } = useLanguage();
  const notify = useToast();
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  if (!user) return null;

  async function changeLanguage(next: Language) {
    if (next === language) return;
    await setLanguage(next);
    try {
      await updateProfile({ preferred_language: next });
    } catch {
      // `i18n.t`, not this render's `t`: the message must be in the NEW language.
      notify(i18n.t("profile:languageSyncFailed")); // synced on the next start-up
    }
  }

  const initials = user.full_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <Screen edges={["top"]}>
      <AppText variant="h3" weight="bold" role="heading">
        {t("profile:title")}
      </AppText>
      <Card style={styles.identity}>
        <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <AppText variant="h4" weight="bold" color={colors.brand700}>
            {initials}
          </AppText>
        </View>
        <View style={styles.identityText}>
          <AppText variant="lead" weight="semibold">
            {user.full_name}
          </AppText>
          <View style={styles.phoneRow}>
            <AppText color={colors.inkMuted} lang={language}>
              {localizeDigits(formatBdMobile(user.mobile_number), language)}
            </AppText>
            {user.is_mobile_verified ? (
              <View style={styles.verified}>
                <BadgeCheck size={16} color={colors.success700} />
                <AppText variant="caption" weight="medium" color={colors.success700}>
                  {t("profile:verified")}
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText variant="small" color={colors.inkSubtle}>
            {t("profile:email")}: {user.email || t("profile:noEmail")}
          </AppText>
          {user.display_name ? (
            <AppText variant="small" color={colors.inkSubtle}>
              {t("profile:displayName")}: {user.display_name}
            </AppText>
          ) : null}
          <AppText variant="small" color={colors.inkSubtle}>
            {t("profile:memberSince", { date: formatDate(user.date_joined, language) })}
          </AppText>
        </View>
      </Card>

      <Section title={t("profile:sectionSettings")}>
        <AppText weight="medium">{t("profile:language")}</AppText>
        <LanguagePicker value={language} onChange={(next) => void changeLanguage(next)} />
        <NotificationsRow />
      </Section>

      <Section title={t("profile:sectionAccount")}>
        <Row icon={<PencilLine size={20} color={colors.brand700} />} label={t("profile:editProfile")} onPress={() => router.push("/edit-profile")} />
        <Row icon={<KeyRound size={20} color={colors.brand700} />} label={t("profile:changePassword")} onPress={() => router.push("/change-password")} />
        <Row icon={<LogOut size={20} color={colors.danger700} />} label={t("profile:signOut")} danger onPress={() => setConfirming(true)} />
      </Section>

      <ConfirmDialog
        open={confirming}
        title={t("profile:signOutTitle")}
        body={t("profile:signOutBody")}
        confirmLabel={t("profile:signOut")}
        tone="danger"
        busy={signingOut}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setSigningOut(true);
          await signOut();
        }}
      />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="small" weight="semibold" color={colors.inkMuted} role="heading">
        {title}
      </AppText>
      <Card style={styles.sectionCard}>{children}</Card>
    </View>
  );
}

function Row({ icon, label, onPress, danger }: { icon: React.ReactNode; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.canvas }]}>
      {icon}
      <AppText weight="medium" color={danger ? colors.danger700 : colors.ink} style={styles.rowLabel}>
        {label}
      </AppText>
      {danger ? null : <ChevronRight size={20} color={colors.inkSubtle} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", gap: space.lg, alignItems: "flex-start" },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brand100, alignItems: "center", justifyContent: "center" },
  identityText: { flex: 1, gap: 2 },
  phoneRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  verified: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.success50, borderRadius: radius.full, paddingHorizontal: space.sm, paddingVertical: 2 },
  section: { gap: space.sm },
  sectionCard: { gap: space.sm },
  row: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.control, paddingHorizontal: space.xs },
  rowLabel: { flex: 1 },
});
