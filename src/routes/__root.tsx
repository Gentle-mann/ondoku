import { Outlet } from '@tanstack/react-router'

export function RootLayout() {
  return (
    <div className="w-full min-h-dvh bg-background text-foreground">
      <Outlet />
    </div>
  )
}
