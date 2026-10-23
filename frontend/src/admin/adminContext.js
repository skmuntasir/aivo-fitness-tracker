import { createContext, useContext } from 'react';

export const AdminContext = createContext({ admin: null, logout: () => {}, theme: 'light', toggleTheme: () => {} });
export const useAdmin = () => useContext(AdminContext);
