import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";

import { pushSupported, refreshPush, routeForNotification } from "./push";

// While the app is open a notification still shows as a banner.
if (pushSupported()) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/** In the signed-in area: register again if notifications were on, and open the exam a tapped notification
 * is about (also when the tap is what started the app). Nothing happens without an Expo project. */
export function usePushSetup(): void {
  const handled = useRef<string | null>(null);
  const last = Notifications.useLastNotificationResponse();

  useEffect(() => {
    void refreshPush();
  }, []);

  useEffect(() => {
    if (!last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const target = routeForNotification(last.notification.request.content.data);
    if (target) router.push(target);
  }, [last]);
}
