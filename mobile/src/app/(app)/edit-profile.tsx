import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError, fieldErrors } from "@/api/describe";
import { useAuth } from "@/auth/provider";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { TextField } from "@/components/text-field";
import { useToast } from "@/components/toast";
import { space } from "@/theme";

const FIELDS = ["full_name", "email", "display_name"] as const;
type Form = Record<(typeof FIELDS)[number], string>;

/** Name, optional email and optional leaderboard name. The mobile number cannot be changed
 * here (the server refuses it). Only changed fields are sent. */
export default function EditProfileScreen() {
  const { t } = useTranslation();
  const { user, updateProfile } = useAuth();
  const notify = useToast();
  const initial: Form = { full_name: user?.full_name ?? "", email: user?.email ?? "", display_name: user?.display_name ?? "" };
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<Partial<Form>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof Form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    if (busy) return;
    const trimmed: Form = { full_name: form.full_name.trim(), email: form.email.trim(), display_name: form.display_name.trim() };
    setFailure(null);
    if (!trimmed.full_name) {
      setErrors({ full_name: t("required") });
      return;
    }
    const changed = FIELDS.filter((field) => trimmed[field] !== initial[field]);
    if (!changed.length) {
      notify(t("profile:unchanged"));
      router.back();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await updateProfile(Object.fromEntries(changed.map((field) => [field, trimmed[field]])));
      notify(t("profile:saved"));
      router.back();
    } catch (caught) {
      const fields = fieldErrors(caught, FIELDS);
      setErrors(fields);
      if (!Object.keys(fields).length) setFailure(describeError(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button label={busy ? t("saving") : t("save")} onPress={save} loading={busy} />}>
      <PageHeader title={t("profile:editProfile")} />
      {failure ? <Banner tone="error" message={failure} /> : null}
      <View style={styles.form}>
        <TextField label={t("profile:fullName")} error={errors.full_name} value={form.full_name} onChangeText={set("full_name")} autoComplete="name" autoCapitalize="words" maxLength={150} editable={!busy} />
        <TextField
          label={t("profile:email")}
          optionalLabel={t("auth:register.optional")}
          error={errors.email}
          value={form.email}
          onChangeText={set("email")}
          keyboardType="email-address"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={254}
          editable={!busy}
        />
        <TextField
          label={t("profile:displayName")}
          hint={t("profile:displayNameHint")}
          error={errors.display_name}
          value={form.display_name}
          onChangeText={set("display_name")}
          maxLength={60}
          editable={!busy}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ form: { gap: space.lg } });
