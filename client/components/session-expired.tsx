import { Button } from "@/components/ui/button";

export const SessionExpired = ({ what }: { what: string }) => (
  <section className="rounded-lg border bg-white p-8 text-center" role="alert">
    <h2 className="font-medium">Your session has expired</h2>
    <p className="text-muted-foreground mt-2 mb-5 text-sm">
      Sign in again to view your {what}.
    </p>
    <Button onClick={() => window.location.reload()}>Sign in again</Button>
  </section>
);
