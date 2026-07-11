import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyDDgzecXUM8MpHker6MYNtQf4YMaFy54xs",
  authDomain: "datasouschef.firebaseapp.com",
  projectId: "datasouschef",
  storageBucket: "datasouschef.firebasestorage.app",
  messagingSenderId: "759921712794",
  appId: "1:759921712794:web:64a0c20416a9a915c40923"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
