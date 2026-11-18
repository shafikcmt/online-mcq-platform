import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError, fieldErrors } from "@/api/describe";
import { useAuth } from "@/auth/provider";
import { AppText } from "@/components/app-text";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { TextField } from "@/components/text-field";
import { space } from "@/theme";

const POINTS = ["erased", "signedOut", "kept", "again"] as const;

/** Delete the account (Google Play and privacy practice: a person can always erase their data). Says
 * plainly what goes and what stays, asks for the current password, then asks once more before the
 * server anonymises the account. Success signs this phone out; the sign-in screen says so. */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const { deleteAccount } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  function ask() {
    setFailure(null);
    if (!password) return setError(t("required"));
    setError(undefined);
    setConfirming(true);
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await deleteAccount(password);
    } catch (caught) {
      // A wrong password stays on the screen, under the field; anything else is shown above it.
      const fields = fieldErrors(caught, ["current_password"]);
      setError(fields.current_password);
      if (!fields.current_password) setFailure(describeError(caught, t));
      setConfirming(false);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <PageHeader title={t("profile:delete.title")} />
      <Banner tone="error" message={t("profile:delete.warning")} />
      {failure ? <Banner tone="error" message={failure} /> : null}
      <Card style={styles.points}>
        {POINTS.map((key) => (
          <AppText key={key} variant="small">
            {`•  ${t(`profile:delete.points.${key}`)}`}
          </AppText>
        ))}
      </Card>
      <View style={styles.form}>
        <TextField
          label={t("profile:delete.password")}
          hint={t("profile:delete.passwordHint")}
          error={error}
          secret
          value={password}
          onChangeText={setPassword}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={ask}
          editable={!busy}
        />
        <Button label={t("profile:delete.submit")} variant="danger" onPress={ask} />
      </View>
      <ConfirmDialog
        open={confirming}
        title={t("profile:delete.confirmTitle")}
        body={t("profile:delete.confirmBody")}
        confirmLabel={t("profile:delete.confirm")}
        tone="danger"
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={confirm}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ points: { gap: space.sm }, form: { gap: space.lg } });
