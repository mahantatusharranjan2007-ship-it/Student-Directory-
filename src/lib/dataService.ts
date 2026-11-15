import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const memoryCache: Record<string, CacheEntry<any>> = {};

// Tracks whether the Express /api backend is present (e.g., AI Studio / Node server)
// vs static SPA hosting (e.g., Vercel) where /api/* returns 404 or index.html.
let apiBackendStatus: 'unknown' | 'available' | 'unavailable' = 'unknown';

function getCached<T>(key: string): T | null {
  const entry = memoryCache[key];
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data as T;
  }
  return null;
}

function setCached<T>(key: string, data: T): void {
  memoryCache[key] = {
    data,
    timestamp: Date.now(),
  };
}

function invalidateCacheStartsWith(prefix: string): void {
  for (const key of Object.keys(memoryCache)) {
    if (key.startsWith(prefix)) {
      delete memoryCache[key];
    }
  }
}

async function tryApiFetch<T>(url: string, options?: RequestInit): Promise<T | null> {
  if (apiBackendStatus === 'unavailable') {
    return null;
  }

  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      // Static hosting (e.g., Vercel SPA fallback serving index.html or 404 HTML)
      apiBackendStatus = 'unavailable';
      return null;
    }

    if (!response.ok) {
      return null;
    }

    apiBackendStatus = 'available';
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export interface ClassGroup {
  id?: string;
  year: number;
  title: string;
  createdAt: number;
  imageUrl?: string;
}

export interface StudentProfile {
  id: number;
  name: string;
  username: string;
  rollNumber: string;
  bio: string;
  imageUrl: string;
  graduationYear: number;
  instagram?: string;
  snapchat?: string;
  tc?: boolean;
  ownerUid: string;
}

export interface Photo {
  id: string;
  studentId: number;
  imageUrl: string;
  createdAt: number;
  ownerUid: string;
}

export interface GlobalSettings {
  isEditingDisabled: boolean;
}

export const dataService = {
  async getSettings(): Promise<GlobalSettings> {
    const cacheKey = 'settings_global';
    const cached = getCached<GlobalSettings>(cacheKey);
    if (cached !== null) return cached;

    const apiData = await tryApiFetch<GlobalSettings>('/api/settings');
    if (apiData) {
      setCached(cacheKey, apiData);
      return apiData;
    }

    try {
      const snap = await getDoc(doc(db, 'settings', 'global'));
      const data = snap.exists() ? (snap.data() as GlobalSettings) : { isEditingDisabled: false };
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      console.warn('Firestore settings fallback:', error);
      return { isEditingDisabled: false };
    }
  },

  async updateSettings(data: GlobalSettings): Promise<GlobalSettings> {
    const cacheKey = 'settings_global';
    setCached(cacheKey, data);

    const apiData = await tryApiFetch<GlobalSettings>('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (apiData) return apiData;

    try {
      await setDoc(doc(db, 'settings', 'global'), data);
      return data;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/global');
    }
  },

  async getClasses(): Promise<ClassGroup[]> {
    const fallback: ClassGroup[] = [
      { id: '2024', year: 2024, title: 'Class of 2024-27', createdAt: Date.now() },
      { id: '2025', year: 2025, title: 'Class of 2025', createdAt: Date.now() },
    ];

    const cacheKey = 'classes_list';
    const cached = getCached<ClassGroup[]>(cacheKey);
    if (cached !== null) return cached;

    const apiData = await tryApiFetch<ClassGroup[]>('/api/classes');
    if (Array.isArray(apiData) && apiData.length > 0) {
      setCached(cacheKey, apiData);
      return apiData;
    }

    try {
      const snapshot = await getDocs(collection(db, 'classes'));
      let data: ClassGroup[] = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ClassGroup, 'id'>) }));
      data.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
      if (data.length === 0) {
        data = fallback;
      }
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      console.warn('Firestore classes fallback:', error);
      return fallback;
    }
  },

  async getClassByYear(year: string | number): Promise<ClassGroup> {
    const yearStr = String(year);
    const yearNum = Number(year);
    const defaultInfo: ClassGroup = {
      year: isNaN(yearNum) ? 2024 : yearNum,
      title: yearNum === 2024 ? 'Class of 2024-27' : `Class of ${yearStr}`,
      createdAt: Date.now(),
    };

    const cacheKey = `class_${yearStr}`;
    const cached = getCached<ClassGroup>(cacheKey);
    if (cached !== null) return cached;

    const apiData = await tryApiFetch<ClassGroup>(`/api/classes/${yearStr}`);
    if (apiData) {
      setCached(cacheKey, apiData);
      return apiData;
    }

    try {
      const snap = await getDoc(doc(db, 'classes', yearStr));
      const data = snap.exists() ? (snap.data() as ClassGroup) : defaultInfo;
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      console.warn(`Firestore class ${yearStr} fallback:`, error);
      return defaultInfo;
    }
  },

  async createClass(payload: ClassGroup): Promise<ClassGroup> {
    const yearStr = String(payload.year);
    setCached(`class_${yearStr}`, payload);
    invalidateCacheStartsWith('classes_list');

    const apiData = await tryApiFetch<ClassGroup>('/api/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (apiData) return apiData;

    try {
      await setDoc(doc(db, 'classes', yearStr), payload);
      return payload;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `classes/${yearStr}`);
    }
  },

  async updateClass(year: string | number, payload: Partial<ClassGroup>): Promise<ClassGroup> {
    const yearStr = String(year);
    const cacheKey = `class_${yearStr}`;
    invalidateCacheStartsWith('classes_list');

    const apiData = await tryApiFetch<ClassGroup>(`/api/classes/${yearStr}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (apiData) {
      setCached(cacheKey, apiData);
      return apiData;
    }

    try {
      const existingSnap = await getDoc(doc(db, 'classes', yearStr));
      const mergedPayload: ClassGroup = existingSnap.exists()
        ? { ...(existingSnap.data() as ClassGroup), ...payload }
        : {
            year: Number(year),
            title: `Class of ${yearStr}`,
            createdAt: Date.now(),
            ...payload,
          };

      await setDoc(doc(db, 'classes', yearStr), payload, { merge: true });
      setCached(cacheKey, mergedPayload);
      return mergedPayload;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `classes/${yearStr}`);
    }
  },

  async getProfiles(graduationYear?: number): Promise<StudentProfile[]> {
    const cacheKey = `profiles_list_${graduationYear ?? 'all'}`;
    const cached = getCached<StudentProfile[]>(cacheKey);
    if (cached !== null) return cached;

    const url =
      graduationYear !== undefined
        ? `/api/profiles?graduationYear=${graduationYear}`
        : '/api/profiles';
    const apiData = await tryApiFetch<StudentProfile[]>(url);
    if (Array.isArray(apiData)) {
      setCached(cacheKey, apiData);
      return apiData;
    }

    try {
      const colRef = collection(db, 'profiles');
      const q =
        graduationYear !== undefined
          ? query(colRef, where('graduationYear', '==', Number(graduationYear)))
          : colRef;
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((d) => d.data() as StudentProfile);
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      console.warn('Firestore profiles fallback:', error);
      return [];
    }
  },

  async getProfileById(id: string | number): Promise<StudentProfile | null> {
    const idStr = String(id);
    const cacheKey = `profile_${idStr}`;
    const cached = getCached<StudentProfile | null>(cacheKey);
    if (cached !== null) return cached;

    const apiData = await tryApiFetch<StudentProfile | null>(`/api/profiles/${idStr}`);
    if (apiData !== null) {
      setCached(cacheKey, apiData);
      return apiData;
    }

    try {
      const snap = await getDoc(doc(db, 'profiles', idStr));
      const data = snap.exists() ? (snap.data() as StudentProfile) : null;
      if (data) {
        setCached(cacheKey, data);
      }
      return data;
    } catch (error) {
      console.warn(`Firestore profile ${idStr} fallback:`, error);
      return null;
    }
  },

  async saveProfile(data: StudentProfile): Promise<StudentProfile> {
    const idStr = String(data.id);
    setCached(`profile_${idStr}`, data);
    invalidateCacheStartsWith('profiles_list_');

    const apiData = await tryApiFetch<StudentProfile>('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (apiData) return apiData;

    try {
      await setDoc(doc(db, 'profiles', idStr), data, { merge: true });
      return data;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `profiles/${idStr}`);
    }
  },

  async getPhotos(studentId?: string | number): Promise<Photo[]> {
    const cacheKey = `photos_list_${studentId ?? 'all'}`;
    const cached = getCached<Photo[]>(cacheKey);
    if (cached !== null) return cached;

    const url = studentId !== undefined ? `/api/photos?studentId=${studentId}` : '/api/photos';
    const apiData = await tryApiFetch<Photo[]>(url);
    if (Array.isArray(apiData)) {
      setCached(cacheKey, apiData);
      return apiData;
    }

    try {
      const colRef = collection(db, 'photos');
      const q =
        studentId !== undefined
          ? query(colRef, where('studentId', '==', Number(studentId)))
          : colRef;
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((d) => d.data() as Photo);
      data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setCached(cacheKey, data);
      return data;
    } catch (error) {
      console.warn('Firestore photos fallback:', error);
      return [];
    }
  },

  async uploadPhoto(photo: Photo): Promise<Photo> {
    invalidateCacheStartsWith('photos_list_');

    const apiData = await tryApiFetch<Photo>('/api/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(photo),
    });
    if (apiData) return apiData;

    try {
      await setDoc(doc(db, 'photos', photo.id), photo);
      return photo;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `photos/${photo.id}`);
    }
  },

  async deletePhoto(photoId: string): Promise<void> {
    invalidateCacheStartsWith('photos_list_');

    const apiData = await tryApiFetch<{ success: boolean }>(`/api/photos/${photoId}`, {
      method: 'DELETE',
    });
    if (apiData?.success) return;

    try {
      await deleteDoc(doc(db, 'photos', photoId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `photos/${photoId}`);
    }
  },
};
