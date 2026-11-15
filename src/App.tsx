/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import Home from './pages/Home';
import Profile from './pages/Profile';
import ClassView from './pages/ClassView';
import Layout from './components/Layout';
import { AuthProvider } from './contexts/AuthContext';
import { SettingsProvider } from './contexts/SettingsContext';

export default function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <Router>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="class/:year" element={<ClassView />} />
              <Route path="student/:id" element={<Profile />} />
            </Route>
          </Routes>
        </Router>
        <Analytics />
      </SettingsProvider>
    </AuthProvider>
  );
}
