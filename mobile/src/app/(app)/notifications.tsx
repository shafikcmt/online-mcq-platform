import * as Linking from "expo-linking";
import { router } from "expo-router";
import { BadgeCheck, CheckCheck, CreditCard, FileText, Megaphone, Pin } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { API_BASE_URL } from "@/api/client";
import { describeError } from "@/api/describe";
import { AppText } from "@/components/app-text";
import { Badge } from "@/components/badge";
import { Banner } from "@/components/banner";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { PagedList } from "@/components/paged-list";
import { Segmented } from "@/components/segmented";
import { useToast } from "@/components/toast";
import { EmptyNote } from "@/features/dashboard/section";
import { fetchNoticePdfLink, fetchNotices, fetchNotifications, markAllRead, markRead } from "@/features/notifications/api";
import type { Notice, Notification } from "@/features/notifications/types";
import { formatDateTime } from "@/lib/format";
import { usePages, type Page } from "@/lib/use-pages";
import { colors, radius, space, touchTarget } from "@/theme";

type View_ = "mine" | "notices";

/** The student's own notifications (results published, payments confirmed) and the
 * notices the admin publishes for students. Opening a notification marks it read and
 * goes to what it is about. */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const [view, setView] = useState<View_>("mine");
  const header = (extra?: React.ReactNode) => (
    <>
      <PageHeader title={t("notifications:title")} />
      <Segmented
        label={t("notifications:filters.label")}
        value={view}
        onChange={setView}
        options={(["mine", "notices"] as const).map((value) => ({ value, label: t(`notifications:filters.${value}`) }))}
      />
      {extra}
    </>
  );
  return <SafeAreaView style={styles.safe} edges={["top"]}>{view === "mine" ? <Mine header={header} /> : <Notices header={header()} />}</SafeAreaView>;
}

const idOf = (item: Notification) => item.id;

function Mine({ header }: { header: (extra?: React.ReactNode) => React.ReactElement }) {
  const { t } = useTranslation();
  const notify = useToast();
  const load = useCallback((page: number) => fetchNotifications(page), []);
  const list = usePages<Notification, Page<Notification>>(load, "mine", idOf);
  const [readNow, setReadNow] = useState<Set<string>>(new Set());
  const [allRead, setAllRead] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const isRead = (item: Notification) => allRead || item.is_read || readNow.has(item.id);
  const anyUnread = list.items.some((item) => !isRead(item));

  async function open(item: Notification) {
    if (!isRead(item)) {
      setReadNow((prev) => new Set(prev).add(item.id));
      void markRead(item.id).catch(() => undefined); // marked again on the next open if it failed
    }
    if (item.target?.type === "payment") router.push({ pathname: "/payment/[id]", params: { id: item.target.payment_id } });
    else if (item.target?.type === "result") router.push({ pathname: "/result/[id]", params: { id: item.target.attempt_id } });
  }

  async function readAll() {
    setFailure(null);
    try {
      await markAllRead();
      setAllRead(true);
      notify(t("notifications:markedAll"));
    } catch (error) {
      setFailure(error);
    }
  }

  return (
    <PagedList<Notification>
      testID="notification-list"
      list={list}
      keyOf={idOf}
      header={header(
        <>
          {anyUnread ? (
            <Pressable accessibilityRole="button" onPress={readAll} style={styles.markAll} hitSlop={8}>
              <CheckCheck size={18} color={colors.brand700} />
              <AppText variant="small" weight="semibold" color={colors.brand700}>
                {t("notifications:markAll")}
              </AppText>
            </Pressable>
          ) : null}
          {failure ? <Banner tone="error" message={describeError(failure, t)} /> : null}
        </>,
      )}
      empty={<EmptyNote text={t("notifications:empty.mine")} />}
      renderItem={({ item }) => <NotificationRow item={item} read={isRead(item)} onPress={() => void open(item)} />}
    />
  );
}

function NotificationRow({ item, read, onPress }: { item: Notification; read: boolean; onPress: () => void }) {
  const { t, i18n } = useTranslation();
  const Icon = item.type === "payment_success" ? CreditCard : BadgeCheck;
  return (
    <Pressable
      accessibilityRole={item.target ? "link" : undefined}
      accessibilityLabel={[read ? null : t("notifications:unread"), item.title, item.message].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !read && styles.unread, pressed && styles.pressed]}
    >
      <View style={[styles.icon, { backgroundColor: item.type === "payment_success" ? colors.success50 : colors.brand50 }]}>
        <Icon size={20} color={item.type === "payment_success" ? colors.success700 : colors.brand700} />
      </View>
      <View style={styles.body}>
        <AppText weight={read ? "medium" : "bold"}>{item.title}</AppText>
        <AppText variant="small" color={colors.inkMuted}>
          {item.message}
        </AppText>
        <AppText variant="caption" color={colors.inkSubtle}>
          {formatDateTime(item.created_at, i18n.language)}
        </AppText>
      </View>
      {read ? null : <View style={styles.dot} accessibilityElementsHidden importantForAccessibility="no" />}
    </Pressable>
  );
}

const noticeKey = (notice: Notice) => String(notice.id);

function Notices({ header }: { header: React.ReactElement }) {
  const { t, i18n } = useTranslation();
  const notify = useToast();
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

  const load = useCallback((page: number) => fetchNotices(page), []);
  const list = usePages<Notice, Page<Notice>>(load, "notices", noticeKey);
  return (
    <PagedList<Notice>
      testID="notice-list"
      list={list}
      keyOf={noticeKey}
      header={header}
      empty={<EmptyNote text={t("notifications:empty.notices")} />}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: colors.warning50 }]}>
            <Megaphone size={20} color={colors.warning700} />
          </View>
          <View style={styles.body}>
            <AppText weight="bold">{item.title}</AppText>
            {item.exam ? (
              <Pressable accessibilityRole="link" hitSlop={6} onPress={() => router.push({ pathname: "/exam/[slug]", params: { slug: item.exam?.slug ?? "" } })}>
                <AppText variant="small" weight="semibold" color={colors.brand700}>
                  {t("notifications:aboutExam", { title: item.exam.title })}
                </AppText>
              </Pressable>
            ) : null}
            <AppText variant="small">{item.body}</AppText>
            {item.pdf?.available ? (
              <Button
                label={opening === item.id ? t("notifications:openingPdf") : t("notifications:openPdf")}
                variant="secondary"
                disabled={opening !== null}
                onPress={() => void openPdf(item)}
                icon={<FileText size={18} color={colors.brand700} />}
              />
            ) : null}
            <View style={styles.meta}>
              {item.is_pinned ? <Badge label={t("notifications:pinned")} tone="warning" icon={<Pin size={12} color={colors.warning700} />} /> : null}
              <AppText variant="caption" color={colors.inkSubtle}>
                {formatDateTime(item.published_at, i18n.language)}
              </AppText>
            </View>
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  markAll: { flexDirection: "row", alignItems: "center", gap: space.xs, alignSelf: "flex-end", minHeight: touchTarget - 8 },
  row: { flexDirection: "row", gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  unread: { borderColor: colors.brand100, backgroundColor: colors.brand50 },
  pressed: { opacity: 0.85 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 2 },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand600, marginTop: space.xs },
});
