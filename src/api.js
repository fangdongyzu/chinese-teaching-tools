import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  connectAuthEmulator,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";
import { createClassroomStore } from "./classroom-store.js";
import { createSignInFlow } from "./sign-in.js";
export { enrollmentRecord } from "./classroom-store.js";
export const configured = Boolean(
  firebaseConfig?.projectId && firebaseConfig?.apiKey,
);
const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
const classroom = app
  ? createClassroomStore({ db, getUser: () => auth.currentUser })
  : null;
if (
  import.meta.env.DEV &&
  import.meta.env.VITE_USE_EMULATORS === "true" &&
  app
) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
export const observeAuth = (handler) =>
  auth ? onAuthStateChanged(auth, handler) : handler(null);
function provider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}
const signIn = auth
  ? createSignInFlow({
      authDomain: firebaseConfig.authDomain,
      location: window.location,
      history: window.history,
      storage: () => window.sessionStorage,
      userAgent: navigator.userAgent,
      popup: () => signInWithPopup(auth, provider()),
      redirect: () => signInWithRedirect(auth, provider()),
      redirectResult: () => getRedirectResult(auth),
      authReady: () => auth.authStateReady(),
      currentUser: () => auth.currentUser,
      local:
        import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true",
    })
  : null;
export const login = () => signIn.login();
export const finishSignIn = async () => signIn?.finish();
export const logout = () => signOut(auth);
export async function call(name, data = {}) {
  if (!classroom) throw new Error("Firebase setup is not complete yet.");
  return classroom.call(name, data);
}
export const assignmentFromEnrollment = (record) =>
  classroom.assignmentFromEnrollment(record);
