import React, { createContext, useContext, useState, useEffect } from 'react';
import { dataService } from '../lib/dataService';

interface SettingsContextType {
  isEditingDisabled: boolean;
  toggleEditProfile: () => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isEditingDisabled, setIsEditingDisabled] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await dataService.getSettings();
        setIsEditingDisabled(data.isEditingDisabled);
      } catch (error) {
        console.error("Error fetching settings:", error);
      }
    };
    fetchSettings();
  }, []);

  const toggleEditProfile = async () => {
    const newState = !isEditingDisabled;
    try {
      await dataService.updateSettings({ isEditingDisabled: newState });
      setIsEditingDisabled(newState);
    } catch (error) {
      console.error("Error updating settings:", error);
    }
  };

  return (
    <SettingsContext.Provider value={{ isEditingDisabled, toggleEditProfile }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
