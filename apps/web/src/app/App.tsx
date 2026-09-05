import { RouterProvider } from "react-router";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { ErrorBoundary } from "./ErrorBoundary";
import { router } from "./router";
export function App() {
  return (
    <LocaleProvider>
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </LocaleProvider>
  );
}
