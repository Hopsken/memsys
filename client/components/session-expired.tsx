import { Button } from "@/components/ui/button";

export const SessionExpired = () => (
  <section className="rounded-lg border bg-white p-8 text-center" role="alert">
    <h2 className="mb-5 font-medium">Your session has expired</h2>
    <Button onClick={() => window.location.reload()}>Sign in again</Button>
  </section>
);
