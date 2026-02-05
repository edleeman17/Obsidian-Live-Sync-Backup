/**
 * Notification module for Uptime Kuma push notifications.
 */

/**
 * Send a push notification to Uptime Kuma.
 *
 * @param pushUrl - The Uptime Kuma push URL
 * @param status - "up" for success, "down" for failure
 * @param message - Optional status message
 */
export async function notifyUptimeKuma(
  pushUrl: string,
  status: "up" | "down" = "up",
  message?: string
): Promise<void> {
  try {
    const url = new URL(pushUrl);
    url.searchParams.set("status", status);
    if (message) {
      url.searchParams.set("msg", message);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (response.ok) {
      console.log(`Uptime Kuma notified: ${status}`);
    } else {
      console.warn(`Uptime Kuma notification failed: ${response.status}`);
    }
  } catch (error) {
    // Don't fail the backup if notification fails
    console.warn(`Uptime Kuma notification error: ${error}`);
  }
}
