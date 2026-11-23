import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBqPkyvSs066OcwasdAkXvOsAycgdXEBKM",
  authDomain: "planli-39e77.firebaseapp.com",
  projectId: "planli-39e77",
  storageBucket: "planli-39e77.firebasestorage.app",
  messagingSenderId: "1032316876103",
  appId: "1:1032316876103:web:bb9563bca3d088f0f00862"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export default app;
