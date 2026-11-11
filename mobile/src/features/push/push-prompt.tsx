import { Bell } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppText } from "@/components/app-text";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { colors, space } from "@/theme";

import { dismissPrompt, enablePush, promptDismissed, pushState } from "./push";

/** A one-time card on Home offering to turn on exam reminders. Shown only when push can work, is not on yet
 * and has not been dismissed; "Not now" hides it for good (the Profile switch stays). */
export function PushPrompt() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([pushState(), promptDismissed()]).then(([state, dismissed]) => alive && setShow(state === "off" && !dismissed));
    return () => {
      alive = false;
    };
  }, []);

  if (!show) return null;
  async function turnOn() {
    setBusy(true);
    await enablePush();
    await dismissPrompt();
    setShow(false);
  }
  async function later() {
    await dismissPrompt();
    setShow(false);
  }
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Bell size={22} color={colors.brand700} />
        <AppText weight="bold" role="heading" style={styles.title}>
          {t("home:push.title")}
        </AppText>
      </View>
      <AppText variant="small" color={colors.inkMuted}>
        {t("home:push.body")}
      </AppText>
      <View style={styles.actions}>
        <Button label={t("home:push.turnOn")} onPress={() => void turnOn()} loading={busy} />
        <Button label={t("home:push.later")} variant="secondary" onPress={() => void later()} disabled={busy} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, backgroundColor: colors.brand50, borderColor: colors.brand100 },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { flex: 1 },
  actions: { gap: space.sm },
});
