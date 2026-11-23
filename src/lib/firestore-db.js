// Firestore drop-in for db.js — plans are stored per user under:
//   users/{userId}/plans/{planId}
import {
  collection, doc, getDocs, setDoc, deleteDoc, serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase.js';

function plansRef(userId) {
  return collection(db, 'users', userId, 'plans');
}

export async function getAllPlans(userId) {
  const snap = await getDocs(plansRef(userId));
  return snap.docs.map(d => d.data());
}

export async function savePlan(userId, plan) {
  const ref = doc(db, 'users', userId, 'plans', plan.id);
  await setDoc(ref, { ...plan, updatedAt: serverTimestamp() }, { merge: true });
  return plan;
}

export async function deletePlan(userId, planId) {
  const ref = doc(db, 'users', userId, 'plans', planId);
  await deleteDoc(ref);
}
