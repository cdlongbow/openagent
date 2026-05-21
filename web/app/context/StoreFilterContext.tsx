import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

type StoreFilterContextValue = {
  storeFilterEnabled: boolean
  setStoreFilterEnabled: (enabled: boolean) => void
}

const StoreFilterContext = createContext<StoreFilterContextValue>({
  storeFilterEnabled: false,
  setStoreFilterEnabled: () => {},
})

export function StoreFilterProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false)

  return (
    <StoreFilterContext.Provider value={{ storeFilterEnabled: enabled, setStoreFilterEnabled: setEnabled }}>
      {children}
    </StoreFilterContext.Provider>
  )
}

export function useStoreFilterEnabled() {
  return useContext(StoreFilterContext)
}

export function useDeclareStoreFilter(enabled: boolean) {
  const { setStoreFilterEnabled } = useContext(StoreFilterContext)
  useEffect(() => {
    setStoreFilterEnabled(enabled)
    return () => setStoreFilterEnabled(false)
  }, [enabled, setStoreFilterEnabled])
}
