import { createBrowserRouter } from "react-router";
import { AppShell } from "./AppShell";
import { LandingPage } from "../pages/LandingPage";
import { StartPage } from "../pages/StartPage";
import { CommunicationPage } from "../pages/CommunicationPage";
import { NotFoundPage } from "../pages/NotFoundPage";
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <LandingPage /> },
      { path: "/start", element: <StartPage /> },
      { path: "/communicate", element: <CommunicationPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
