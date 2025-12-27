"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { LoadingScreen } from "./ui/loading-screen"

interface LoadingContextType {
  isLoading: boolean
  setLoading: (loading: boolean) => void
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined)

export function useLoading() {
  const context = useContext(LoadingContext)
  if (context === undefined) {
    throw new Error("useLoading must be used within a LoadingProvider")
  }
  return context
}

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
    
    // Check if this is the first visit
    const hasVisited = localStorage.getItem('qce-has-visited')
    
    if (!hasVisited) {
      // First time - show loading
      setIsLoading(true)
      localStorage.setItem('qce-has-visited', 'true')
    } else {
      // Not first time - skip loading
      setIsLoading(false)
    }
  }, [])

  const setLoading = (loading: boolean) => {
    setIsLoading(loading)
  }

  const handleLoadingComplete = () => {
    setIsLoading(false)
  }

  return (
    <LoadingContext.Provider value={{ isLoading, setLoading }}>
      {isMounted && (
        <LoadingScreen isLoading={isLoading} onComplete={handleLoadingComplete} />
      )}
      {children}
    </LoadingContext.Provider>
  )
}