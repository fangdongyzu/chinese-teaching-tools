import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  onAuthStateChanged,
  signOut,
  connectAuthEmulator,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator,
} from "firebase/functions";
import { firebaseConfig, functionsRegion } from "./firebase-config.js";
export const backendReady =
  import.meta.env.DEV || import.meta.env.VITE_BACKEND_READY === "true";
export const configured = Boolean(
  firebaseConfig?.projectId && firebaseConfig?.apiKey,
);
const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
const functions = app ? getFunctions(app, functionsRegion) : null;
if (
  import.meta.env.DEV &&
  import.meta.env.VITE_USE_EMULATORS === "true" &&
  app
) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
export const observeAuth = (handler) =>
  auth ? onAuthStateChanged(auth, handler) : handler(null);
export async function login() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === "auth/popup-blocked")
      return signInWithRedirect(auth, provider);
    throw e;
  }
}
export const logout = () => signOut(auth);
export async function call(name, data = {}) {
  if (!functions) throw new Error("Firebase setup is not complete yet.");
  return (await httpsCallable(functions, name)(data)).data;
}
