export const isAppBrowser = (ua = "") =>
  /Line\/|FBAN\/|FBAV\/|Instagram|MicroMessenger|; wv\)/i.test(ua);
export const isPhoneBrowser = (ua = "") =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

// Firebase's default Hosting alias and auth helpers share one origin. Keep
// mobile redirects there rather than crossing web.app -> firebaseapp.com.
export function classroomSignInUrl(href, authDomain, start = false) {
  const original = new URL(href);
  const target = new URL(`https://${authDomain}/`);
  const join = original.searchParams.get("join");
  if (join && /^[A-Z2-9]{7}$/i.test(join))
    target.searchParams.set("join", join);
  if (start) target.searchParams.set("signin", "1");
  return target.href;
}

export function checkSignInStorage(storage) {
  const key = "classroom-signin-storage-check";
  try {
    if (typeof storage === "function") storage = storage();
    storage.setItem(key, "1");
    if (storage.getItem(key) !== "1") throw Error();
    storage.removeItem(key);
  } catch {
    throw new Error(
      "Your browser cannot save the sign-in session. Open the classroom directly in Safari or Chrome with browser storage enabled, then try again.",
    );
  }
}

export function signInError(error) {
  if (error?.code === "auth/popup-closed-by-user")
    return "The Google sign-in window was closed. Choose Continue with Google to try again.";
  if (error?.code === "auth/web-storage-unsupported")
    return "Your browser cannot save the sign-in session. Open the classroom directly in Safari or Chrome with browser storage enabled.";
  if (error?.code === "auth/cancelled-popup-request")
    return "A sign-in request is already open. Finish that request, or try again.";
  return String(
    error?.message ||
      "Sign-in could not finish. Open the classroom directly in Safari or Chrome and try again.",
  ).replace(/^Firebase:\s*/, "");
}

export function createSignInFlow({
  authDomain,
  location,
  history,
  storage,
  userAgent,
  popup,
  redirect,
  redirectResult,
  authReady,
  currentUser,
  local = false,
}) {
  function supportedBrowser() {
    if (isAppBrowser(userAgent))
      throw new Error(
        "Open this classroom in Safari or Chrome to sign in. In LINE or another app, use its menu to open the link in your browser, then choose Continue with Google.",
      );
  }
  async function redirectOnSameOrigin() {
    const target = classroomSignInUrl(location.href, authDomain, true);
    if (new URL(location.href).origin !== new URL(target).origin) {
      location.assign(target);
      return;
    }
    checkSignInStorage(storage);
    return redirect();
  }
  return {
    async login() {
      supportedBrowser();
      if (!local && isPhoneBrowser(userAgent)) return redirectOnSameOrigin();
      try {
        return await popup();
      } catch (error) {
        if (error.code === "auth/popup-blocked" && !local)
          return redirectOnSameOrigin();
        throw error;
      }
    },
    async finish() {
      const url = new URL(location.href);
      const start = url.searchParams.get("signin") === "1" && !local;
      if (start) {
        url.searchParams.delete("signin");
        history.replaceState({}, "", url.pathname + url.search + url.hash);
      }
      // Calling getRedirectResult explicitly also surfaces redirect errors in
      // the classroom instead of silently dropping the user back at sign-in.
      await redirectResult();
      if (!start) return;
      await authReady();
      if (currentUser()) return;
      supportedBrowser();
      return redirectOnSameOrigin();
    },
  };
}
