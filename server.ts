import express from 'express';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, query, where, orderBy } from 'firebase/firestore';
import { readFileSync } from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';

const firebaseConfig = JSON.parse(readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf-8'));

const app = express();
const PORT = 3000;

// Initialize Firebase
const appInstance = initializeApp(firebaseConfig);
const db = getFirestore(appInstance, firebaseConfig.firestoreDatabaseId);

app.use(express.json({ limit: '50mb' }));

// API Routes
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 2 * 60 * 1000; // 2 minutes (keeps data fresh while eliminating intense Firestore reads)
const memoryCache: { [key: string]: CacheEntry<any> } = {};

function getCached<T>(key: string): T | null {
  const entry = memoryCache[key];
  if (entry && (Date.now() - entry.timestamp) < CACHE_TTL) {
    return entry.data;
  }
  return null;
}

function setCached<T>(key: string, data: T): void {
  memoryCache[key] = {
    data,
    timestamp: Date.now()
  };
}

function invalidateCacheStartsWith(prefix: string): void {
  for (const key of Object.keys(memoryCache)) {
    if (key.startsWith(prefix)) {
      delete memoryCache[key];
    }
  }
}

function isDeepEqual(obj1: any, obj2: any): boolean {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}

// Global settings
app.get('/api/settings', async (req, res) => {
  try {
    const cacheKey = 'settings_global';
    const cached = getCached<any>(cacheKey);
    if (cached !== null) {
      return res.json(cached);
    }
    const docSnap = await getDoc(doc(db, 'settings', 'global'));
    const data = docSnap.exists() ? docSnap.data() : { isEditingDisabled: false };
    setCached(cacheKey, data);
    res.json(data);
  } catch (error) {
    console.error("Error in GET /api/settings (fallback applied):", error);
    res.json({ isEditingDisabled: false });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const data = req.body;
    const cacheKey = 'settings_global';
    setCached(cacheKey, data);

    try {
      await setDoc(doc(db, 'settings', 'global'), data);
    } catch (dbErr) {
      console.warn("Firestore write skipped/failed for settings:", dbErr);
    }
    res.json(data);
  } catch (error) {
    console.error("Error in POST /api/settings:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

app.get('/api/classes', async (req, res) => {
  const fallback = [
    { id: '2024', year: 2024, title: 'Class of 2024-27', createdAt: Date.now() },
    { id: '2025', year: 2025, title: 'Class of 2025', createdAt: Date.now() }
  ];
  try {
    const cacheKey = 'classes_list';
    const cached = getCached<any[]>(cacheKey);
    if (cached !== null) {
      return res.json(cached);
    }
    const snapshot = await getDocs(collection(db, 'classes'));
    let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    data.sort((a: any, b: any) => (Number(b.year) || 0) - (Number(a.year) || 0));
    if (data.length === 0) {
      data = fallback;
    }
    setCached(cacheKey, data);
    res.json(data);
  } catch (error) {
    console.error("Error in GET /api/classes (using fallback):", error);
    res.json(fallback);
  }
});

app.get('/api/classes/:year', async (req, res) => {
  const { year } = req.params;
  const yearNum = parseInt(year);
  const defaultInfo = {
    year: isNaN(yearNum) ? 2024 : yearNum,
    title: yearNum === 2024 ? 'Class of 2024-27' : `Class of ${year}`
  };
  try {
    const cacheKey = `class_${year}`;
    const cached = getCached<any>(cacheKey);
    if (cached !== null) {
      return res.json(cached);
    }
    const docSnap = await getDoc(doc(db, 'classes', year));
    const data = docSnap.exists() ? docSnap.data() : defaultInfo;
    setCached(cacheKey, data);
    res.json(data);
  } catch (error) {
    console.error("Error in GET /api/classes/:year (using fallback):", error);
    res.json(defaultInfo);
  }
});

app.post('/api/classes', async (req, res) => {
  try {
    const { year, ...data } = req.body;
    const cacheKey = `class_${year}`;
    const fullPayload = { year, ...data };
    setCached(cacheKey, fullPayload);
    invalidateCacheStartsWith('classes_list');

    try {
      await setDoc(doc(db, 'classes', String(year)), fullPayload);
    } catch (dbErr) {
      console.warn("Firestore write skipped/failed for class create:", dbErr);
    }
    res.json(fullPayload);
  } catch (error) {
    console.error("Error in POST /api/classes:", error);
    res.status(500).json({ error: "Failed to create class" });
  }
});

app.put('/api/classes/:year', async (req, res) => {
  try {
    const { year } = req.params;
    const cacheKey = `class_${year}`;
    let mergedPayload = { year: parseInt(year), ...req.body };

    try {
      const existingDataDocSnap = await getDoc(doc(db, 'classes', year));
      if (existingDataDocSnap.exists()) {
        mergedPayload = { ...existingDataDocSnap.data(), ...req.body };
      }
      await setDoc(doc(db, 'classes', year), req.body, { merge: true });
    } catch (dbErr) {
      console.warn("Firestore write skipped/failed for class update:", dbErr);
    }

    setCached(cacheKey, mergedPayload);
    invalidateCacheStartsWith('classes_list');
    res.json(mergedPayload);
  } catch (error) {
    console.error("Error in PUT /api/classes/:year:", error);
    res.status(500).json({ error: "Failed to update class" });
  }
});

app.get('/api/profiles', async (req, res) => {
  try {
    const { graduationYear } = req.query;
    const cacheKey = `profiles_list_${graduationYear || 'all'}`;
    const cached = getCached<any[]>(cacheKey);
    if (cached !== null) {
      return res.json(cached);
    }
    let q = query(collection(db, 'profiles'));
    if (graduationYear) {
      q = query(q, where('graduationYear', '==', Number(graduationYear)));
    }
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(doc => doc.data());
    setCached(cacheKey, data);
    res.json(data);
  } catch (error) {
    console.error("Error in GET /api/profiles (using fallback):", error);
    const cached = getCached<any[]>(`profiles_list_${req.query.graduationYear || 'all'}`);
    res.json(cached || []);
  }
});

app.get('/api/profiles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `profile_${id}`;
    const cached = getCached<any>(cacheKey);
    if (cached !== null) {
      return res.json(cached);
    }
    const snapshot = await getDoc(doc(db, 'profiles', id));
    const data = snapshot.exists() ? snapshot.data() : null;
    if (data) {
      setCached(cacheKey, data);
    }
    res.json(data);
  } catch (error) {
    console.error("Error in GET /api/profiles/:id (using fallback):", error);
    const cached = getCached<any>(`profile_${req.params.id}`);
    res.json(cached || null);
  }
});

app.post('/api/profiles', async (req, res) => {
  try {
    const data = req.body;
    const id = String(data.id);
    const cacheKey = `profile_${id}`;

    setCached(cacheKey, data);
    invalidateCacheStartsWith('profiles_list_');

    try {
      await setDoc(doc(db, 'profiles', id), data, { merge: true });
    } catch (dbErr) {
      console.warn("Firestore write skipped/failed for profile:", dbErr);
    }
    res.json(data);
  } catch (error) {
    console.error("Error in POST /api/profiles:", error);
    res.status(500).json({ error: "Failed to save profile" });
  }
});

app.get('/api/photos', async (req, res) => {
  try {
    const { studentId } = req.query;
    const cacheKey = `photos_list_${studentId || 'all'}`;
    const cached = getCached<any[]>(cacheKey);
    if (cached !== null) {
      return res.json(cached);
    }
    let q = query(collection(db, 'photos'));
    if (studentId) {
      q = query(q, where('studentId', '==', Number(studentId)));
    }
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(doc => doc.data());
    // Sort in memory to avoid needing composite Firestore index
    data.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
    setCached(cacheKey, data);
    res.json(data);
  } catch (error) {
    console.error("Error in GET /api/photos (using fallback):", error);
    const cached = getCached<any[]>(`photos_list_${req.query.studentId || 'all'}`);
    res.json(cached || []);
  }
});

app.post('/api/photos', async (req, res) => {
  try {
    const data = req.body;
    invalidateCacheStartsWith('photos_list_');
    try {
      await setDoc(doc(db, 'photos', data.id), data);
    } catch (dbErr) {
      console.warn("Firestore photo write failed/skipped:", dbErr);
    }
    res.json(data);
  } catch (error) {
    console.error("Error in POST /api/photos:", error);
    res.status(500).json({ error: "Failed to upload photo" });
  }
});

app.delete('/api/photos/:id', async (req, res) => {
  try {
    invalidateCacheStartsWith('photos_list_');
    try {
      await deleteDoc(doc(db, 'photos', req.params.id));
    } catch (dbErr) {
      console.warn("Firestore photo delete failed/skipped:", dbErr);
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error in DELETE /api/photos/:id:", error);
    res.status(500).json({ success: false, error: "Failed to delete photo" });
  }
});

// Vite middleware
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
