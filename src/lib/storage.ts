import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { getStorageInstance } from "./firebase";

export async function uploadAudio(
  seriesId: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ path: string; url: string }> {
  const path = `audio/${seriesId}/${file.name}`;
  const storageRef = ref(getStorageInstance(), path);
  const task = uploadBytesResumable(storageRef, file);

  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
        onProgress?.(pct);
      },
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({ path, url });
      }
    );
  });
}

export async function deleteAudio(path: string): Promise<void> {
  if (!path) return;
  try {
    await deleteObject(ref(getStorageInstance(), path));
  } catch {
    // Ignore if already deleted
  }
}
