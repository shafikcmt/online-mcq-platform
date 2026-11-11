import { useEffect, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Linking from "expo-linking";

import { AppText } from "@/components/app-text";
import { Button } from "@/components/button";
import { useToast } from "@/components/toast";
import { colors, space } from "@/theme";

import { disablePush, enablePush, pushState, type PushState } from "./push";

/** The profile switch for exam reminders and notices. Hidden when push cannot work (no Expo project yet). */
export function NotificationsRow() {
  const { t } = useTranslation();
  const notify = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void pushState().then((value) => alive && setState(value));
    return () => {
      alive = false;
    };
  }, []);

  if (state === null || state === "unsupported") return null;

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        const result = await enablePush();
        setState(result === "on" ? "on" : result === "denied" ? "denied" : "off");
        if (result === "error") notify(t("profile:pushError"));
      } else {
        await disablePush();
        setState("off");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.text}>
          <AppText weight="medium">{t("profile:push")}</AppText>
          <AppText variant="small" color={colors.inkMuted}>
            {state === "denied" ? t("profile:pushDenied") : t("profile:pushHint")}
          </AppText>
        </View>
        <Switch
          accessibilityLabel={t("profile:push")}
          value={state === "on"}
          onValueChange={(next) => void toggle(next)}
          disabled={busy || state === "denied"}
          trackColor={{ true: colors.brand600, false: colors.line }}
        />
      </View>
      {state === "denied" ? <Button label={t("profile:pushSettings")} variant="secondary" onPress={() => void Linking.openSettings()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  text: { flex: 1, gap: 2 },
});
