import { createFileRoute, useLocation } from "@tanstack/react-router";
import { validLoginReturnTo } from "../features/auth";
import { ConfirmPage } from "../features/confirm/confirm-page";

export const Route = createFileRoute("/confirm/$action")({
  component: ConfirmRoute,
});

function ConfirmRoute() {
  const { action } = Route.useParams();
  // The raw query string: the router's parsed search turns an ID such as 123 into a number.
  const location = useLocation();
  return <ConfirmPage action={action} search={location.searchStr} returnTo={validLoginReturnTo(`${location.pathname}${location.searchStr}`)} />;
}
