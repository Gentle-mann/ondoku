import { createRootRoute, createRoute } from '@tanstack/react-router'
import { RootLayout } from './routes/__root'
import { LibraryPage } from './routes/library'
import { ReaderPage } from './routes/reader'

export const rootRoute = createRootRoute({ component: RootLayout })

export const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LibraryPage,
})

export const readerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/read/$bookId',
  component: ReaderPage,
})

export const routeTree = rootRoute.addChildren([libraryRoute, readerRoute])
