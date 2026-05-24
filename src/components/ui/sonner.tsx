"use client"

import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  // NOTE: We don't use next-themes ThemeProvider in this app.
  // Theme is managed manually via document.documentElement.classList.add/remove('dark')
  // and localStorage('attendo-theme'). We detect the current theme from the DOM directly.
  const isDark = typeof document !== 'undefined' 
    ? document.documentElement.classList.contains('dark') 
    : false

  return (
    <Sonner
      theme={isDark ? "dark" : "light"}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
