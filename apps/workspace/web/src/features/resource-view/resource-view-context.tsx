import { createContext, useContext } from "react";

export const ResourceViewContext = createContext({
  immersive: false,
});

export const useResourceView = () => useContext(ResourceViewContext);
