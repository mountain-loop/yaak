import { lazy } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useParams } from 'react-router-dom';
import { paths, useAppRoutes } from '../hooks/useAppRoutes';
import { DefaultLayout } from './DefaultLayout';
import { RedirectToLatestWorkspace } from './RedirectToLatestWorkspace';
import RouteError from './RouteError';

const LazyWorkspace = lazy(() => import('./Workspace'));
const LazySettings = lazy(() => import('./Settings/Settings'));

const router = createBrowserRouter([
  {
    path: '/',
    errorElement: <RouteError />,
    element: <DefaultLayout />,
    children: [
      {
        path: '/',
        element: <RedirectToLatestWorkspace />,
      },
      {
        path: paths.workspaces(),
        element: <RedirectToLatestWorkspace />,
      },
      {
        path: paths.workspace({
          workspaceId: ':workspaceId',
          environmentId: null,
          cookieJarId: null,
        }),
        element: <LazyWorkspace />,
      },
      {
        path: paths.request({
          workspaceId: ':workspaceId',
          requestId: ':requestId',
          environmentId: null,
          cookieJarId: null,
        }),
        element: <LazyWorkspace />,
      },
      {
        path: '/workspaces/:workspaceId/environments/:environmentId/requests/:requestId',
        element: <RedirectLegacyEnvironmentURLs />,
      },
      {
        path: paths.workspaceSettings({
          workspaceId: ':workspaceId',
          environmentId: null,
          cookieJarId: null,
        }),
        element: <LazySettings />,
      },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}

function RedirectLegacyEnvironmentURLs() {
  const routes = useAppRoutes();
  const {
    requestId,
    environmentId: rawEnvironmentId,
    workspaceId,
  } = useParams<{
    requestId?: string;
    workspaceId?: string;
    environmentId?: string;
  }>();
  const environmentId = (rawEnvironmentId === '__default__' ? undefined : rawEnvironmentId) ?? null;

  let to;
  if (workspaceId != null && requestId != null) {
    to = routes.paths.request({ workspaceId, environmentId, requestId, cookieJarId: null });
  } else if (workspaceId != null) {
    to = routes.paths.workspace({ workspaceId, environmentId, cookieJarId: null });
  } else {
    to = routes.paths.workspaces();
  }

  return <Navigate to={to} />;
}
