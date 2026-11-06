import { createContext, useContext } from 'react';

export type OwnerAccess = { required: boolean; signOut: () => Promise<void> };
export const OwnerAccessContext = createContext<OwnerAccess>({ required: false, signOut: async () => {} });
export const useOwnerAccess = () => useContext(OwnerAccessContext);
