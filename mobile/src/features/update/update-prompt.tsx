import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useEffect, useRef, useState } from "react";
import { AppState, Modal, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Button } from "@/components/button";
import { colors, radius, space } from "@/theme";

import { fetchAppUpdate } from "./api";
import { dismissedVersion, dismissVersion } from "./dismissed";
import type { AppUpdate } from "./types";

const RECHECK_MS = 30 * 60_000;
const isHttps = (url: string) => /^https:\/\/[^\s]+$/i.test(url);
const isPlay = (url: string) => /^https:\/\/play\.google\.com\//i.test(url);

/** Asks the server and reports the notice to show (or null). Never throws: offline or server
 * trouble simply means no notice. */
async function checkForUpdate(show: (notice: AppUpdate | null) => void): Promise<void> {
  const version = Constants.expoConfig?.version;
  if (!version) return;
  try {
    const answer = await fetchAppUpdate(version);
    if (!answer.update_available || !isHttps(answer.download_url)) return show(null);
    if (!answer.update_required && (await dismissedVersion()) === answer.latest_version) return;
    show(answer);
  } catch {
    // no notice
  }
}

/** Tells the student a newer app version is out, with how to get it. The server compares
 * versions (the app only reports its own), so the rule can change without a new app. The
 * link is the site setting an admin controls: an APK today, Google Play after launch, so
 * the same notice keeps working. A normal update can be postponed ("Later", remembered
 * for that version); a required one blocks until the app is updated. Any failure to ask
 * is silent: a missing notice must never get in the way of an exam. */
export function UpdatePrompt() {
  const { t } = useTranslation("update");
  const [notice, setNotice] = useState<AppUpdate | null>(null);
  const lastCheck = useRef(0);

  useEffect(() => {
    lastCheck.current = Date.now();
    void checkForUpdate(setNotice);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && Date.now() - lastCheck.current > RECHECK_MS) {
        lastCheck.current = Date.now();
        void checkForUpdate(setNotice);
      }
    });
    return () => subscription.remove();
  }, []);

  if (!notice) return null;
  const required = notice.update_required;
  const play = isPlay(notice.download_url);

  function later() {
    if (!notice) return;
    setNotice(null); // gone at once; remembering it can finish afterwards
    void dismissVersion(notice.latest_version);
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={required ? undefined : later}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} role="alertdialog" aria-modal accessibilityLabel={t("title")}>
          <AppText variant="h4" weight="bold" role="heading">
            {required ? t("titleRequired") : t("title")}
          </AppText>
          <AppText color={colors.inkMuted}>
            {t("body", { version: notice.latest_version || "" })} {required ? t("requiredBody") : ""}
          </AppText>
          {notice.note ? (
            <View style={styles.note}>
              <AppText weight="semibold">{t("noteTitle")}</AppText>
              <AppText color={colors.inkMuted}>{notice.note}</AppText>
            </View>
          ) : null}
          <AppText color={colors.inkMuted}>{play ? t("stepsPlay") : t("stepsApk")}</AppText>
          <View style={styles.actions}>
            <Button label={t("update")} onPress={() => void Linking.openURL(notice.download_url).catch(() => undefined)} />
            {required ? null : <Button label={t("later")} variant="secondary" onPress={later} />}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.45)", justifyContent: "center", padding: space.lg },
  sheet: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sheet,
    padding: space.xxl,
    gap: space.md,
  },
  note: { gap: space.xs, backgroundColor: colors.brand50, borderRadius: radius.sheet, padding: space.md },
  actions: { gap: space.sm, marginTop: space.sm },
});
