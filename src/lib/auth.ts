import { signInWithPopup, GoogleAuthProvider, signOut as fbSignOut } from "firebase/auth";
import { getAuthInstance } from "./firebase";

const provider = new GoogleAuthProvider();

export async function signInWithGoogle() {
  return signInWithPopup(getAuthInstance(), provider);
}

export async function signOut() {
  return fbSignOut(getAuthInstance());
}
