import { CloudOff } from "lucide-react-native";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View, type ListRenderItem } from "react-native";
import { useTranslation } from "react-i18next";

import { describeError } from "@/api/describe";
import { colors, radius, space } from "@/theme";

import { AppText } from "./app-text";
import { Banner } from "./banner";
import { Button } from "./button";

type List<T> = {
  items: T[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: unknown;
  refresh: () => void;
  retry: () => void;
  loadMore: () => void;
};

type Props<T> = {
  testID?: string;
  list: List<T>;
  keyOf: (item: T) => string;
  renderItem: ListRenderItem<T>;
  header: React.ReactElement;
  /** Shown when the list loaded and is empty. */
  empty: React.ReactElement;
  /** Replaces the generic error state (e.g. "not published yet" for a 403). */
  errorView?: React.ReactElement | null;
  separator?: boolean;
  /** Shown after the last item (and after the list when it is empty), e.g. a labelled extra block. */
  footer?: React.ReactElement | null;
};

/** A paged list screen body: skeleton while loading, an error with retry, an empty state,
 * pull-to-refresh, more items near the end, and a quiet notice when a reload failed but
 * earlier items are still shown. */
export function PagedList<T>({ testID, list, keyOf, renderItem, header, empty, errorView, separator = true, footer }: Props<T>) {
  const { t } = useTranslation();
  let body: React.ReactElement;
  if (list.loading) {
    body = (
      <View style={styles.skeleton} accessible accessibilityLabel={t("loading")} accessibilityState={{ busy: true }}>
        {[88, 88, 88].map((height, index) => (
          <View key={index} style={[styles.block, { height }]} />
        ))}
      </View>
    );
  } else if (list.error) {
    body = errorView ?? (
      <View style={styles.failed}>
        <CloudOff size={36} color={colors.inkSubtle} />
        <AppText color={colors.inkMuted} align="center" role="alert">
          {describeError(list.error, t)}
        </AppText>
        <Button label={t("retry")} variant="secondary" onPress={list.retry} />
      </View>
    );
  } else {
    body = empty;
  }
  return (
    <FlatList
      testID={testID}
      data={list.items}
      keyExtractor={keyOf}
      renderItem={renderItem}
      ListHeaderComponent={
        <View style={styles.header}>
          {header}
          {list.items.length > 0 && list.error ? <Banner tone="info" message={t("home:stale")} /> : null}
        </View>
      }
      ListEmptyComponent={body}
      ListFooterComponent={
        list.loadingMore || footer ? (
          <>
            {list.loadingMore ? (
              <View style={styles.more}>
                <ActivityIndicator color={colors.brand600} />
              </View>
            ) : null}
            {footer}
          </>
        ) : undefined
      }
      onEndReached={list.loadMore}
      onEndReachedThreshold={0.4}
      refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[colors.brand600]} tintColor={colors.brand600} />}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={separator ? () => <View style={styles.gap} /> : undefined}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, paddingVertical: space.xxl, width: "100%", maxWidth: 560, alignSelf: "center" },
  header: { gap: space.lg, marginBottom: space.lg },
  gap: { height: space.sm },
  skeleton: { gap: space.md },
  block: { borderRadius: radius.card, backgroundColor: colors.line },
  failed: { alignItems: "center", gap: space.md, marginTop: space.xxl },
  more: { paddingVertical: space.xl },
});
